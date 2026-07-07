// Deterministic segmentation for Achieve/FDR welcome-call QA.
//
// A full transcript includes Pennie enrollment/disclosure before the actual
// Achieve/FDR welcome-call flow begins. We grade ONLY the post-handoff segment,
// and we never grade an unbounded transcript: when no reliable boundary exists,
// segment_found=false and the module skips the LLM entirely (mis-routed calls
// and failed handoffs are recorded, not graded). This keeps Pennie-internal
// content out of results shared with the external partner.
//
// Boundary strategy (2026-07-03 audit of all 64 routed calls):
// 1. Speaker label (primary): the transcript feed labels every third-party-leg
//    line "[transfer agent]:"; the first such line was the true handoff boundary
//    in 60/60 real-handoff calls, and the 4 calls without one were mis-routes.
// 2. Content markers (secondary, label-less feeds only). "client success
//    advocate" and coordinator-handoff phrasing are gone — both misfired on
//    Pennie-side speech in the audit.
//
// Beyond Finance is a COMPETITOR, not the Achieve/FDR partner. Agents sometimes
// mis-transfer to it; those calls must never be graded here (results are shown to
// Achieve in an external portal — grading a competitor call there is a conflict of
// interest). We detect a competitor greeting ON THE TRANSFER LEG ONLY (Regal
// payloads carry no transfer-destination number) and record a `competitor_transfer`
// skip with an empty segment. Pennie-side ("[handling agent]:") mentions of Beyond
// before the handoff do NOT count.

export type SegmentationConfidence = "high" | "medium" | "low"

export type SegmentSkipReason = "no_transfer_leg" | "transfer_leg_too_short" | "competitor_transfer"

export interface WelcomeCallSegment {
  segment_found: boolean
  skip_reason: SegmentSkipReason | null
  segment: string
  start_line: number
  marker: string | null
  segmentation_confidence: SegmentationConfidence
  segmentation_score: number
  transfer_agent_lines: number
  /** Kept because the QVV portal keys transcript display on it; always false now. */
  used_full_transcript_fallback: boolean
}

const TRANSFER_AGENT_LABEL = /^\s*\[transfer\s*agent\]\s*:/i

// ponytail: 10 ≈ ceiling of IVR/disclosure boilerplate seen in failed handoffs;
// real welcome calls run 40+ transfer-agent lines. Tune here if a real call trips it.
const MIN_TRANSFER_AGENT_LINES = 10

// Competitor (Beyond Finance) detection — greeting / agent self-identification only.
// Bare "with beyond finance" is intentionally NOT matched: legit FDR calls where the
// customer is switching FROM Beyond say things like "cancel your program with Beyond
// Finance". Only a competitor GREETING or the transfer agent identifying themselves as
// Beyond signals a mis-transfer.
const COMPETITOR_GREETING = /thank you for (calling|contacting)[^\n]{0,40}beyond finance/i
const COMPETITOR_SELF_ID = /(my name is|this is) [a-z]+ (with|from) beyond finance/i

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

export function segmentWelcomeCall(transcript: string): WelcomeCallSegment {
  const lines = transcript.split("\n")

  const labelLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (TRANSFER_AGENT_LABEL.test(lines[i])) labelLines.push(i)
  }

  if (labelLines.length > 0) {
    if (labelLines.length < MIN_TRANSFER_AGENT_LINES) {
      // Handoff attempted but the advocate never joined (IVR/disclosure boilerplate
      // only) — grading this would score Pennie content. Skip.
      return {
        segment_found: false,
        skip_reason: "transfer_leg_too_short",
        segment: "",
        start_line: labelLines[0],
        marker: "transfer_agent_label",
        segmentation_confidence: "low",
        segmentation_score: 0.3,
        transfer_agent_lines: labelLines.length,
        used_full_transcript_fallback: false,
      }
    }
    // A real transfer leg exists, but it may be to Beyond Finance (a competitor), not
    // Achieve. Scan ONLY the transfer-agent-labeled lines for a competitor greeting or
    // self-identification — Pennie-side ("[handling agent]:") Beyond mentions don't count.
    for (const idx of labelLines) {
      if (COMPETITOR_GREETING.test(lines[idx]) || COMPETITOR_SELF_ID.test(lines[idx])) {
        return {
          segment_found: false,
          skip_reason: "competitor_transfer",
          segment: "",
          start_line: labelLines[0],
          marker: "beyond_finance_transfer",
          segmentation_confidence: "high",
          segmentation_score: 0.95,
          transfer_agent_lines: labelLines.length,
          used_full_transcript_fallback: false,
        }
      }
    }
    return {
      segment_found: true,
      skip_reason: null,
      segment: lines.slice(labelLines[0]).join("\n").trim(),
      start_line: labelLines[0],
      marker: "transfer_agent_label",
      segmentation_confidence: "high",
      segmentation_score: 0.98,
      transfer_agent_lines: labelLines.length,
      used_full_transcript_fallback: false,
    }
  }

  // Label-less transcript: earliest content-marker line wins.
  for (let i = 0; i < lines.length; i++) {
    // A Beyond Finance greeting here means a competitor mis-transfer — skip, don't grade.
    if (COMPETITOR_GREETING.test(lines[i])) {
      return {
        segment_found: false,
        skip_reason: "competitor_transfer",
        segment: "",
        start_line: i,
        marker: "beyond_finance_transfer",
        segmentation_confidence: "high",
        segmentation_score: 0.95,
        transfer_agent_lines: 0,
        used_full_transcript_fallback: false,
      }
    }
    for (const m of MARKERS) {
      if (m.pattern.test(lines[i])) {
        return {
          segment_found: true,
          skip_reason: null,
          segment: lines.slice(i).join("\n").trim(),
          start_line: i,
          marker: m.label,
          segmentation_confidence: m.confidence,
          segmentation_score: m.score,
          transfer_agent_lines: 0,
          used_full_transcript_fallback: false,
        }
      }
    }
  }

  // No boundary: return NO content. The module skips the LLM for this call.
  return {
    segment_found: false,
    skip_reason: "no_transfer_leg",
    segment: "",
    start_line: 0,
    marker: null,
    segmentation_confidence: "low",
    segmentation_score: 0,
    transfer_agent_lines: 0,
    used_full_transcript_fallback: false,
  }
}
