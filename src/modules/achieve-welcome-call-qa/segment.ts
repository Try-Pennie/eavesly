// Deterministic segmentation for Achieve/FDR welcome-call QA.
//
// A full transcript includes Pennie enrollment/disclosure before the actual
// Achieve/FDR welcome-call flow begins. We grade ONLY the post-handoff segment,
// and we never grade an unbounded transcript: when no reliable boundary exists,
// segment_found=false and the module skips the LLM entirely (mis-routed calls
// and failed handoffs are recorded, not graded). This keeps Pennie-internal
// content out of results shared with the external partner.
//
// Boundary strategy:
// 1. Speaker labels identify third-party audio, but that audio can be IVR, a live
//    welcome representative, customer service, or administrative troubleshooting.
// 2. A labeled call is gradeable only after a live welcome representative is
//    identified and either the client engages or substantive welcome scripting starts.
// 3. Label-less feeds require both an FDR boundary marker and live-welcome evidence;
//    handling-agent mentions of a future welcome call never establish applicability.
//
// Beyond Finance is a COMPETITOR, not the Achieve/FDR partner. Agents sometimes
// mis-transfer to it; those calls must never be graded here (results are shown to
// Achieve in an external portal — grading a competitor call there is a conflict of
// interest). We detect a competitor greeting ON THE TRANSFER LEG ONLY (Regal
// payloads carry no transfer-destination number) and record a `competitor_transfer`
// skip with an empty segment. Pennie-side ("[handling agent]:") mentions of Beyond
// before the handoff do NOT count.

export type SegmentationConfidence = "high" | "medium" | "low"

export type SegmentSkipReason =
  | "no_transfer_leg"
  | "transfer_leg_too_short"
  | "no_live_welcome_agent"
  | "non_welcome_transfer"
  | "welcome_call_not_started"
  | "unbounded_label_less"
  | "competitor_transfer"

export interface WelcomeCallSegment {
  segment_found: boolean
  skip_reason: SegmentSkipReason | null
  segment: string
  start_line: number
  end_line: number
  marker: string | null
  segmentation_confidence: SegmentationConfidence
  segmentation_score: number
  transfer_agent_lines: number
  /** Kept because the QVV portal keys transcript display on it; always false now. */
  used_full_transcript_fallback: boolean
}

const TRANSFER_AGENT_LABEL = /^\s*\[transfer\s*agent\]\s*:/i
const CONTACT_LABEL = /^\s*\[contact\]\s*:/i

// Preserve the legacy short-leg reason when no live representative is found and
// fewer than 10 transfer lines exist. Longer IVR-only legs get no_live_welcome_agent.
const MIN_TRANSFER_AGENT_LINES = 10

// Competitor (Beyond Finance) detection — greeting / agent self-identification only.
// Bare "with beyond finance" is intentionally NOT matched: legit FDR calls where the
// customer is switching FROM Beyond say things like "cancel your program with Beyond
// Finance". Only a competitor GREETING or the transfer agent identifying themselves as
// Beyond signals a mis-transfer.
const COMPETITOR_GREETING = /thank you for (calling|contacting)[^\n]{0,40}beyond finance/i
const COMPETITOR_SELF_ID = /(my name is|this is) [a-z]+ (with|from) beyond finance/i

// Explicit existing-client/customer-service routing is not the welcome-call queue.
// Keep these patterns tied to the inbound greeting/menu so ordinary welcome-call
// references to the customer-service number do not create false skips.
const NON_WELCOME_SERVICE = /thank you for calling freedom debt relief customer service|currently a client and (?:have|has) (?:a )?question/i
const CUSTOMER_SERVICE_HANDOFF = /(?:transfer|connect) you (?:over )?to (?:our )?(?:general )?customer service/i

// A transfer-agent label is also used for IVR audio. Require evidence that a live
// welcome-call representative joined before treating the leg as gradeable. Generic
// automated "welcome and congratulations" wording does not qualify.
const LIVE_WELCOME_REP = new RegExp(
  [
    String.raw`\b(?:my name is|this is|i['’]?m)\s+[a-z]+\s+(?:with|from)\s+freedom debt relief\b`,
    String.raw`\bwelcome call\b.{0,100}\b(?:my name is|this is|who do i have|may i|can i)\b`,
    String.raw`\b(?:my name is|this is|i['’]?m)\b.{0,100}\bwelcome call\b`,
    String.raw`\b(?:my name is|this is|i['’]?m)\b.{0,100}\bclient\b.{0,30}\badvocate\b`,
    String.raw`\bclient\b.{0,30}\badvocate\b.{0,100}\b(?:my name is|this is|i['’]?m)\b`,
    String.raw`\b(?:my name is|this is|i['’]?m)\b.{0,100}\bget (?:you )?started (?:with|in) (?:your|the) program\b`,
  ].join("|"),
  "i",
)

// A queue representative can join only to troubleshoot a pending agreement. Do not
// grade until the client-facing welcome interaction actually starts. One substantive
// welcome-script signal is enough; the LLM still decides whether each element passed.
const WELCOME_CALL_BLOCKED = /waiting (?:in|for) (?:the )?(?:agreement|acknowledgment)|welcome call pending|not allowing me to proceed.{0,40}welcome call|(?:cannot|can't|unable|won't be able) to (?:proceed|do).{0,40}welcome call|nothing i can do.{0,60}welcome call|send the file back|(?:at|in) a standstill/i
const WELCOME_CALL_BLOCKER_RESOLVED = /(?:earlier|previously).{0,100}(?:complete|completed|resolved|ready) now|(?:is|it['’]?s) (?:complete|completed|resolved|ready) now/i

const LIVE_HUMAN_UTTERANCE = /\b(?:my name is|this is|i['’]?m)\b|\b(?:may|can) i (?:please )?(?:have|get|ask)\b|\bwho do i have\b|\b(?:client\s+)?advocate\b|\bwelcome call specialist\b/i

const WELCOME_CALL_STARTED = new RegExp(
  [
    String.raw`\bwelcome (?:you )?to (?:your|the) (?:freedom debt relief )?program\b`,
    String.raw`\b(?:help(?:ing)?|trying to)?\s*get (?:you )?started (?:with|in) (?:your|the) program\b`,
    String.raw`\bhelp you start (?:your|the) program\b`,
    String.raw`\bkeys? to (?:being )?successful\b`,
    String.raw`\bdedicated account\b`,
    String.raw`\bnegotiate with (?:each|your) creditor`,
    String.raw`\bauthoriz(?:e|ing|ation).{0,40}settlement`,
    String.raw`\bclient dashboard\b`,
    String.raw`\bprogram guide\b`,
  ].join("|"),
  "i",
)

const MARKERS: { pattern: RegExp; label: string; confidence: "high" | "medium"; score: number }[] = [
  // "freedom debt relief disclosure line" and the newer "debt resolution" branding
  { pattern: /debt (relief|resolution) disclosure line/i, label: "fdr_disclosure_line_start", confidence: "high", score: 0.95 },
  // observed both "client's" and "customer's"
  { pattern: /enter the (customer|client)'?s (10|ten)[ -]?digit phone number/i, label: "fdr_disclosure_phone_prompt", confidence: "high", score: 0.9 },
  { pattern: /thank you for calling[^\n]{0,40}welcome call/i, label: "welcome_call_greeting", confidence: "high", score: 0.95 },
  { pattern: /welcome call specialist/i, label: "welcome_call_specialist", confidence: "high", score: 0.85 },
  { pattern: /freedom debt relief client dashboard app/i, label: "fdr_dashboard_app", confidence: "high", score: 0.9 },
  { pattern: /log\s?in to your client dashboard/i, label: "client_dashboard_login", confidence: "high", score: 0.9 },
]

function findLastActiveBlockerLine(lines: string[], lineIndexes: number[]): number | null {
  for (let position = lineIndexes.length - 1; position >= 0; position--) {
    const lineIndex = lineIndexes[position]
    const line = lines[lineIndex]
    if (WELCOME_CALL_BLOCKED.test(line) && !WELCOME_CALL_BLOCKER_RESOLVED.test(line)) return lineIndex
  }
  return null
}

function findLastMatchingLine(lines: string[], lineIndexes: number[], pattern: RegExp): number | null {
  for (let position = lineIndexes.length - 1; position >= 0; position--) {
    const lineIndex = lineIndexes[position]
    if (pattern.test(lines[lineIndex])) return lineIndex
  }
  return null
}

/**
 * Returns the first transfer-agent line with live welcome-representative evidence.
 * The bounded three-line fallback preserves split ASR greetings.
 */
export function findLiveWelcomeRepLine(
  lines: readonly string[],
  labelLines: readonly number[],
): number | null {
  for (const lineIndex of labelLines) {
    if (LIVE_WELCOME_REP.test(lines[lineIndex])) return lineIndex
  }

  // ASR can split a representative's greeting across transfer-agent utterances
  // when another speaker talks over it. Use a small fallback window only when no
  // individual line identified the representative.
  for (let position = 0; position < labelLines.length; position++) {
    const windowLineIndexes = labelLines.slice(position, position + 3)
    const greetingWindow = windowLineIndexes.map((idx) => lines[idx]).join(" ")
    if (LIVE_WELCOME_REP.test(greetingWindow)) {
      return windowLineIndexes.find((idx) => LIVE_HUMAN_UTTERANCE.test(lines[idx])) ?? labelLines[position]
    }
  }
  return null
}

export function segmentWelcomeCall(transcript: string): WelcomeCallSegment {
  const lines = transcript.split("\n")

  const labelLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (TRANSFER_AGENT_LABEL.test(lines[i])) labelLines.push(i)
  }

  if (labelLines.length > 0) {
    // A real transfer leg exists, but it may be to Beyond Finance (a competitor), not
    // Achieve. Scan ONLY the transfer-agent-labeled lines for a competitor greeting or
    // self-identification — Pennie-side ("[handling agent]:") Beyond mentions don't count.
    const lastTransferLine = labelLines[labelLines.length - 1]
    for (const idx of labelLines) {
      if (COMPETITOR_GREETING.test(lines[idx]) || COMPETITOR_SELF_ID.test(lines[idx])) {
        return {
          segment_found: false,
          skip_reason: "competitor_transfer",
          segment: "",
          start_line: labelLines[0],
          end_line: lastTransferLine,
          marker: "beyond_finance_transfer",
          segmentation_confidence: "high",
          segmentation_score: 0.95,
          transfer_agent_lines: labelLines.length,
          used_full_transcript_fallback: false,
        }
      }
    }
    const liveWelcomeRepLine = findLiveWelcomeRepLine(lines, labelLines)
    const serviceLine = labelLines.find((idx) => NON_WELCOME_SERVICE.test(lines[idx])) ?? null
    if (serviceLine !== null && (liveWelcomeRepLine === null || serviceLine < liveWelcomeRepLine)) {
      return {
        segment_found: false,
        skip_reason: "non_welcome_transfer",
        segment: "",
        start_line: serviceLine,
        end_line: lastTransferLine,
        marker: "transfer_agent_label",
        segmentation_confidence: "high",
        segmentation_score: 0.95,
        transfer_agent_lines: labelLines.length,
        used_full_transcript_fallback: false,
      }
    }

    if (liveWelcomeRepLine === null) {
      const tooShort = labelLines.length < MIN_TRANSFER_AGENT_LINES
      return {
        segment_found: false,
        skip_reason: tooShort ? "transfer_leg_too_short" : "no_live_welcome_agent",
        segment: "",
        start_line: labelLines[0],
        end_line: lastTransferLine,
        marker: "transfer_agent_label",
        segmentation_confidence: tooShort ? "low" : "high",
        segmentation_score: tooShort ? 0.3 : 0.9,
        transfer_agent_lines: labelLines.length,
        used_full_transcript_fallback: false,
      }
    }

    const customerServiceHandoffLine = labelLines.find((idx) =>
      idx > liveWelcomeRepLine && CUSTOMER_SERVICE_HANDOFF.test(lines[idx]),
    ) ?? null
    const welcomeEndLine = customerServiceHandoffLine ?? lastTransferLine
    const welcomeTransferLines = labelLines.filter((idx) =>
      idx >= liveWelcomeRepLine && idx <= welcomeEndLine,
    )
    const liveWelcomeSpeech = welcomeTransferLines.map((idx) => lines[idx]).join("\n")
    const hasContactTurn = lines.some((line, index) =>
      index > liveWelcomeRepLine &&
      index < welcomeEndLine &&
      CONTACT_LABEL.test(line) &&
      labelLines.some((transferLine) => transferLine > index),
    )
    const hasStarted = WELCOME_CALL_STARTED.test(liveWelcomeSpeech)
    const lastBlockedLine = findLastActiveBlockerLine(lines, welcomeTransferLines)
    const lastStartedLine = findLastMatchingLine(lines, welcomeTransferLines, WELCOME_CALL_STARTED)
    const endsBlocked = lastBlockedLine !== null && (lastStartedLine === null || lastBlockedLine > lastStartedLine)
    if (endsBlocked || (!hasContactTurn && !hasStarted)) {
      return {
        segment_found: false,
        skip_reason: "welcome_call_not_started",
        segment: "",
        start_line: liveWelcomeRepLine,
        end_line: welcomeEndLine,
        marker: "live_welcome_agent",
        segmentation_confidence: "high",
        segmentation_score: 0.95,
        transfer_agent_lines: labelLines.length,
        used_full_transcript_fallback: false,
      }
    }

    return {
      segment_found: true,
      skip_reason: null,
      segment: lines.slice(liveWelcomeRepLine, welcomeEndLine + 1).join("\n").trim(),
      start_line: liveWelcomeRepLine,
      end_line: welcomeEndLine,
      marker: "live_welcome_agent",
      segmentation_confidence: "high",
      segmentation_score: 0.98,
      transfer_agent_lines: labelLines.length,
      used_full_transcript_fallback: false,
    }
  }

  // Label-less feeds can establish that FDR audio and a live representative exist,
  // but they cannot provide a reliable upper boundary for partner-safe transcript
  // sharing. Classify them for observability, then fail closed before grading.
  let firstBoundary: { line: number; marker: string; confidence: "high" | "medium"; score: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    if (COMPETITOR_GREETING.test(lines[i])) {
      return {
        segment_found: false,
        skip_reason: "competitor_transfer",
        segment: "",
        start_line: i,
        end_line: i,
        marker: "beyond_finance_transfer",
        segmentation_confidence: "high",
        segmentation_score: 0.95,
        transfer_agent_lines: 0,
        used_full_transcript_fallback: false,
      }
    }
    if (firstBoundary === null) {
      const matched = MARKERS.find((candidate) => candidate.pattern.test(lines[i]))
      if (matched) {
        firstBoundary = {
          line: i,
          marker: matched.label,
          confidence: matched.confidence,
          score: matched.score,
        }
      }
    }
  }

  if (firstBoundary !== null && NON_WELCOME_SERVICE.test(transcript)) {
    return {
      segment_found: false,
      skip_reason: "non_welcome_transfer",
      segment: "",
      start_line: firstBoundary.line,
      end_line: lines.length - 1,
      marker: firstBoundary.marker,
      segmentation_confidence: "high",
      segmentation_score: 0.95,
      transfer_agent_lines: 0,
      used_full_transcript_fallback: false,
    }
  }

  const liveWelcomeRepLine = firstBoundary === null
    ? -1
    : lines.findIndex((line, index) => index >= firstBoundary.line && LIVE_WELCOME_REP.test(line))
  if (liveWelcomeRepLine >= 0) {
    const liveWelcomeSpeech = lines.slice(liveWelcomeRepLine).join("\n")
    if (!WELCOME_CALL_STARTED.test(liveWelcomeSpeech)) {
      return {
        segment_found: false,
        skip_reason: "welcome_call_not_started",
        segment: "",
        start_line: liveWelcomeRepLine,
        end_line: lines.length - 1,
        marker: "live_welcome_agent",
        segmentation_confidence: "high",
        segmentation_score: 0.95,
        transfer_agent_lines: 0,
        used_full_transcript_fallback: false,
      }
    }
    return {
      segment_found: false,
      skip_reason: "unbounded_label_less",
      segment: "",
      start_line: liveWelcomeRepLine,
      end_line: lines.length - 1,
      marker: "live_welcome_agent",
      segmentation_confidence: "low",
      segmentation_score: 0.4,
      transfer_agent_lines: 0,
      used_full_transcript_fallback: false,
    }
  }

  if (firstBoundary !== null) {
    return {
      segment_found: false,
      skip_reason: "no_live_welcome_agent",
      segment: "",
      start_line: firstBoundary.line,
      end_line: lines.length - 1,
      marker: firstBoundary.marker,
      segmentation_confidence: firstBoundary.confidence,
      segmentation_score: firstBoundary.score,
      transfer_agent_lines: 0,
      used_full_transcript_fallback: false,
    }
  }

  // No boundary: return NO content. The module skips the LLM for this call.
  return {
    segment_found: false,
    skip_reason: "no_transfer_leg",
    segment: "",
    start_line: 0,
    end_line: 0,
    marker: null,
    segmentation_confidence: "low",
    segmentation_score: 0,
    transfer_agent_lines: 0,
    used_full_transcript_fallback: false,
  }
}
