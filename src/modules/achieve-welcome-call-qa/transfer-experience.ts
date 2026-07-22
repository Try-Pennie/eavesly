import type { WelcomeCallSegment } from "./segment"
import { findLiveWelcomeRepLine } from "./segment"

/** Deterministic reason that can classify a poor transfer experience. */
export type PoorTransferReason =
  | "live_rep_then_ivr_reentry_then_live_rep"
  | "dead_air_handoff"
  | "ghost_pickup"
  | "multi_attempt_no_ivr"

/** Partner-safe evidence from a transfer-agent line inside the bounded segment. */
export interface TransferExperienceEvidence {
  readonly line: number
  readonly quote: string
}

/** ASR-derived metadata for a live welcome-representative attempt. */
export interface WelcomeAgentAttempt extends TransferExperienceEvidence {
  readonly name_asr: string | null
}

/** Deterministic poor-transfer analysis stamped after the LLM evaluation. */
export interface TransferExperience {
  readonly poor_transfer: boolean
  readonly reasons: readonly PoorTransferReason[]
  readonly ivr_reentry_lines: readonly number[]
  readonly agent_attempts: readonly WelcomeAgentAttempt[]
  readonly evidence: readonly TransferExperienceEvidence[]
  readonly detection_version: "achieve_poor_transfer_v1"
}

const TRANSFER_AGENT_LABEL = /^\s*\[transfer\s*agent\]\s*:/i
const TRANSFER_AGENT_LABEL_PREFIX = /^\s*\[transfer\s*agent\]\s*:\s*/i
const CONTACT_LABEL = /^\s*\[contact\]\s*:/i
const CONTACT_LABEL_PREFIX = /^\s*\[contact\]\s*:\s*/i

// A substantive welcome-rep utterance carries real content, not a one-word
// acknowledgement. Used to decide whether the rep actually spoke.
const SUBSTANTIVE_WORD_THRESHOLD = 10
// A "ghost" pickup line is barely any speech at all: the connection opened but
// nobody said anything meaningful.
const GHOST_MAX_WORDS = 5

// The client visibly struggling to reach a human on the other end.
const CLIENT_CONFUSION_PROMPT =
  /\bhello\?|\bhello,?\s*is anyone\b|\bare you there\b|\bcan you hear me\b/i

// A rep deliberately handing the welcome call to a named colleague is a normal,
// non-poor transition — not a dropped-and-reconnected attempt.
const COLLEAGUE_HANDOFF =
  /\bmy colleague\b|\bwill (?:finish|complete|continue) (?:the |your )?welcome call\b|\btransfer(?:ring)? you to (?:my |a )?colleague\b/i

const HOLD_QUEUE = new RegExp(
  [
    String.raw`\bhold(?:ing)?\b`,
    String.raw`\bremain on the line\b`,
    String.raw`\bestimated wait time\b`,
    String.raw`\bnext available representative\b`,
    String.raw`\ball (?:of our )?representatives are (?:currently )?assisting\b`,
    String.raw`\byour call is important to us\b`,
    String.raw`\bwe appreciate your patience\b`,
    String.raw`\bplease wait while (?:i|we) connect you\b`,
  ].join("|"),
  "i",
)

const LIVE_WELCOME_CALL_GREETING = /\bthank you for calling(?: the)? welcome call\b.{0,100}\b(?:my name is|this is|i['’]?m|who do i have|may i|can i)\b/i

const IVR_REENTRY_SIGNALS: readonly RegExp[] = [
  /\bmenu options have changed\b/i,
  /\bfor\s+(?:fdr|freedom debt relief|client enrollment)\s*,?\s*press\s+(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine)\b/i,
  /\b(?:fdr|freedom debt relief(?:['’]s)?) client enrollment department\b/i,
  /\b(?:freedom )?debt (?:relief|resolution) disclosure line\b/i,
  /\b(?:please )?enter (?:the (?:customer|client)['’]?s |your )?(?:10|ten)[ -]?digit phone number\b/i,
]

const NAME_INTRO = /\b(?:my name is|this is|i['’]?m)\s+([a-z][a-z'-]*)\b/i
const NON_NAME_WORDS = new Set(["a", "an", "the", "your", "welcome", "client"])

function transferSpeech(line: string): string {
  return line.replace(TRANSFER_AGENT_LABEL_PREFIX, "").trim()
}

function contactSpeech(line: string): string {
  return line.replace(CONTACT_LABEL_PREFIX, "").trim()
}

function wordCount(speech: string): number {
  return speech.split(/\s+/).filter((token) => token.length > 0).length
}

function isSubstantiveTransferLine(line: string): boolean {
  return (
    TRANSFER_AGENT_LABEL.test(line) &&
    wordCount(transferSpeech(line)) > SUBSTANTIVE_WORD_THRESHOLD
  )
}

function isIvrReentrySpeech(speech: string): boolean {
  return IVR_REENTRY_SIGNALS.some((signal) => signal.test(speech))
}

function findIvrQuote(line: string): string | null {
  const speech = transferSpeech(line)
  if (HOLD_QUEUE.test(speech) || LIVE_WELCOME_CALL_GREETING.test(speech)) return null

  for (const signal of IVR_REENTRY_SIGNALS) {
    const match = speech.match(signal)
    if (match !== null) return match[0]
  }
  return null
}

function attemptFromLine(line: string, lineNumber: number): WelcomeAgentAttempt {
  const speech = transferSpeech(line)
  const intro = speech.match(NAME_INTRO)
  if (intro !== null) {
    const possibleName = intro[1]
    const name = NON_NAME_WORDS.has(possibleName.toLowerCase()) ? null : possibleName
    return { line: lineNumber, name_asr: name, quote: intro[0] }
  }

  const signal = speech.match(
    /\bwelcome call specialist\b|\bclient(?: success)? advocate\b|\bwelcome call\b|\b(?:may|can) i (?:please )?(?:have|get|ask)\b|\bwho do i have\b|\b(?:my name is|this is|i['’]?m)\b/i,
  )
  return {
    line: lineNumber,
    name_asr: null,
    quote: signal?.[0] ?? "",
  }
}

function attemptEvidence(attempt: WelcomeAgentAttempt): TransferExperienceEvidence {
  return { line: attempt.line, quote: attempt.quote }
}

/**
 * Deterministic poor-transfer detection over an already bounded, gradeable
 * welcome-call segment. Four failure patterns are collected independently and
 * any match sets poor_transfer=true:
 *  - live_rep_then_ivr_reentry_then_live_rep: live rep -> known IVR menu -> later rep
 *  - ghost_pickup: near-empty pre-rep transfer audio (connection, but no speech)
 *  - dead_air_handoff: client confusion prompt before the rep speaks substantively
 *  - multi_attempt_no_ivr: a second, differently-named rep with no IVR between
 */
export function analyzeTransferExperience(
  segment: Pick<WelcomeCallSegment, "segment" | "start_line">,
): TransferExperience {
  const lines = segment.segment.split("\n")
  const transferLineIndexes: number[] = []
  for (let index = 0; index < lines.length; index++) {
    if (TRANSFER_AGENT_LABEL.test(lines[index])) transferLineIndexes.push(index)
  }

  const firstLiveRepLine = findLiveWelcomeRepLine(lines, transferLineIndexes)
  if (firstLiveRepLine === null) {
    return {
      poor_transfer: false,
      reasons: [],
      ivr_reentry_lines: [],
      agent_attempts: [],
      evidence: [],
      detection_version: "achieve_poor_transfer_v1",
    }
  }

  const firstAttempt = attemptFromLine(
    lines[firstLiveRepLine],
    segment.start_line + firstLiveRepLine,
  )

  // --- Pattern: live_rep -> known IVR re-entry -> later live rep -----------
  const firstIvrLine = transferLineIndexes.find((lineIndex) =>
    lineIndex > firstLiveRepLine && findIvrQuote(lines[lineIndex]) !== null
  ) ?? null

  let ivrReentryLines: number[] = []
  let ivrEvidence: TransferExperienceEvidence[] = []
  let laterAttempt: WelcomeAgentAttempt | null = null
  if (firstIvrLine !== null) {
    const laterTransferLines = transferLineIndexes.filter((lineIndex) => lineIndex > firstIvrLine)
    const laterLiveRepLine = findLiveWelcomeRepLine(lines, laterTransferLines)
    const reentryUpperBound = laterLiveRepLine ?? lines.length
    ivrEvidence = transferLineIndexes.flatMap((lineIndex) => {
      if (lineIndex < firstIvrLine || lineIndex >= reentryUpperBound) return []
      const quote = findIvrQuote(lines[lineIndex])
      return quote === null
        ? []
        : [{ line: segment.start_line + lineIndex, quote }]
    })
    ivrReentryLines = ivrEvidence.map(({ line }) => line)
    if (laterLiveRepLine !== null) {
      laterAttempt = attemptFromLine(lines[laterLiveRepLine], segment.start_line + laterLiveRepLine)
    }
  }

  // --- Pattern: ghost_pickup ------------------------------------------------
  // Before the live rep is identified, a connection opened but produced only
  // near-empty transfer-agent speech (not hold-queue or IVR-menu audio). This
  // fires whenever the graded segment still carries pre-rep transfer lines.
  const ghostEvidence: TransferExperienceEvidence[] = []
  for (const lineIndex of transferLineIndexes) {
    if (lineIndex >= firstLiveRepLine) break
    const speech = transferSpeech(lines[lineIndex])
    if (
      wordCount(speech) < GHOST_MAX_WORDS &&
      !HOLD_QUEUE.test(speech) &&
      !isIvrReentrySpeech(speech)
    ) {
      ghostEvidence.push({ line: segment.start_line + lineIndex, quote: speech })
    }
  }

  // --- Pattern: dead_air_handoff -------------------------------------------
  // After the rep connects, the client asks "hello?/are you there?" before the
  // rep produces any substantive utterance, and the rep does not answer on the
  // very next line. (A single confusion prompt immediately answered by a
  // substantive line is normal back-and-forth, not dead air.)
  let deadAirEvidence: TransferExperienceEvidence | null = null
  for (let lineIndex = firstLiveRepLine + 1; lineIndex < lines.length; lineIndex++) {
    if (isSubstantiveTransferLine(lines[lineIndex])) break
    if (!CONTACT_LABEL.test(lines[lineIndex])) continue
    const confusion = contactSpeech(lines[lineIndex]).match(CLIENT_CONFUSION_PROMPT)
    if (confusion === null) continue
    const answeredImmediately =
      lineIndex + 1 < lines.length && isSubstantiveTransferLine(lines[lineIndex + 1])
    if (!answeredImmediately) {
      deadAirEvidence = { line: segment.start_line + lineIndex, quote: confusion[0] }
      break
    }
  }

  // --- Pattern: multi_attempt_no_ivr ---------------------------------------
  // A second, differently-named live rep introduces themselves with no IVR
  // re-entry between the two — the rep dropped and reconnected. A named
  // colleague handoff or the same agent re-greeting are explicitly excluded.
  let multiAttempt: WelcomeAgentAttempt | null = null
  const secondRepSearchLines = transferLineIndexes.filter((lineIndex) => lineIndex > firstLiveRepLine)
  const secondRepLine = findLiveWelcomeRepLine(lines, secondRepSearchLines)
  if (secondRepLine !== null) {
    const betweenTransferLines = transferLineIndexes.filter(
      (lineIndex) => lineIndex > firstLiveRepLine && lineIndex < secondRepLine,
    )
    const ivrBetween = betweenTransferLines.some((lineIndex) => findIvrQuote(lines[lineIndex]) !== null)
    let colleagueBetween = false
    for (let lineIndex = firstLiveRepLine; lineIndex < secondRepLine; lineIndex++) {
      if (COLLEAGUE_HANDOFF.test(lines[lineIndex])) {
        colleagueBetween = true
        break
      }
    }
    const secondAttempt = attemptFromLine(lines[secondRepLine], segment.start_line + secondRepLine)
    const distinctNames =
      firstAttempt.name_asr !== null &&
      secondAttempt.name_asr !== null &&
      firstAttempt.name_asr.toLowerCase() !== secondAttempt.name_asr.toLowerCase()
    if (!ivrBetween && !colleagueBetween && distinctNames) {
      multiAttempt = secondAttempt
    }
  }

  // --- Assemble -------------------------------------------------------------
  const ivrFired = laterAttempt !== null
  const reasons: PoorTransferReason[] = []
  if (ghostEvidence.length > 0) reasons.push("ghost_pickup")
  if (deadAirEvidence !== null) reasons.push("dead_air_handoff")
  if (ivrFired) reasons.push("live_rep_then_ivr_reentry_then_live_rep")
  if (multiAttempt !== null) reasons.push("multi_attempt_no_ivr")

  const agentAttempts: WelcomeAgentAttempt[] = [firstAttempt]
  if (laterAttempt !== null) agentAttempts.push(laterAttempt)
  if (multiAttempt !== null) agentAttempts.push(multiAttempt)

  const evidence: TransferExperienceEvidence[] = [attemptEvidence(firstAttempt)]
  evidence.push(...ghostEvidence)
  evidence.push(...ivrEvidence)
  if (deadAirEvidence !== null) evidence.push(deadAirEvidence)
  if (laterAttempt !== null) evidence.push(attemptEvidence(laterAttempt))
  if (multiAttempt !== null) evidence.push(attemptEvidence(multiAttempt))

  return {
    poor_transfer: reasons.length > 0,
    reasons,
    ivr_reentry_lines: ivrReentryLines,
    agent_attempts: agentAttempts,
    evidence,
    detection_version: "achieve_poor_transfer_v1",
  }
}
