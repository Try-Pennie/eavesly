import type { WelcomeCallSegment } from "./segment"
import { findLiveWelcomeRepLine } from "./segment"

/** Deterministic reason that can classify a poor transfer experience. */
export type PoorTransferReason = "live_rep_then_ivr_reentry_then_live_rep"

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
 * Detects a live-rep → known IVR re-entry → later live-rep sequence using only
 * transfer-agent lines from an already bounded, gradeable welcome-call segment.
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

  const firstIvrLine = transferLineIndexes.find((lineIndex) =>
    lineIndex > firstLiveRepLine && findIvrQuote(lines[lineIndex]) !== null
  ) ?? null
  const firstAttempt = attemptFromLine(
    lines[firstLiveRepLine],
    segment.start_line + firstLiveRepLine,
  )

  if (firstIvrLine === null) {
    return {
      poor_transfer: false,
      reasons: [],
      ivr_reentry_lines: [],
      agent_attempts: [firstAttempt],
      evidence: [attemptEvidence(firstAttempt)],
      detection_version: "achieve_poor_transfer_v1",
    }
  }

  const laterTransferLines = transferLineIndexes.filter((lineIndex) => lineIndex > firstIvrLine)
  const laterLiveRepLine = findLiveWelcomeRepLine(lines, laterTransferLines)
  const reentryUpperBound = laterLiveRepLine ?? lines.length
  const ivrEvidence = transferLineIndexes.flatMap((lineIndex) => {
    if (lineIndex < firstIvrLine || lineIndex >= reentryUpperBound) return []
    const quote = findIvrQuote(lines[lineIndex])
    return quote === null
      ? []
      : [{ line: segment.start_line + lineIndex, quote }]
  })

  if (laterLiveRepLine === null) {
    return {
      poor_transfer: false,
      reasons: [],
      ivr_reentry_lines: ivrEvidence.map(({ line }) => line),
      agent_attempts: [firstAttempt],
      evidence: [attemptEvidence(firstAttempt), ...ivrEvidence],
      detection_version: "achieve_poor_transfer_v1",
    }
  }

  const laterAttempt = attemptFromLine(
    lines[laterLiveRepLine],
    segment.start_line + laterLiveRepLine,
  )
  return {
    poor_transfer: true,
    reasons: ["live_rep_then_ivr_reentry_then_live_rep"],
    ivr_reentry_lines: ivrEvidence.map(({ line }) => line),
    agent_attempts: [firstAttempt, laterAttempt],
    evidence: [attemptEvidence(firstAttempt), ...ivrEvidence, attemptEvidence(laterAttempt)],
    detection_version: "achieve_poor_transfer_v1",
  }
}
