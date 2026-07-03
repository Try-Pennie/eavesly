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

export type SegmentationConfidence = "high" | "medium" | "low"

export type SegmentSkipReason = "no_transfer_leg" | "transfer_leg_too_short"

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

const MARKERS: { pattern: RegExp; label: string; confidence: "high" | "medium"; score: number }[] = [
  // "freedom debt relief disclosure line" and the newer "debt resolution" branding
  { pattern: /debt (relief|resolution) disclosure line/i, label: "fdr_disclosure_line_start", confidence: "high", score: 0.95 },
  // observed both "client's" and "customer's"
  { pattern: /enter the (customer|client)'?s (10|ten)[ -]?digit phone number/i, label: "fdr_disclosure_phone_prompt", confidence: "high", score: 0.9 },
  { pattern: /thank you for calling[^\n]{0,40}welcome call/i, label: "welcome_call_greeting", confidence: "high", score: 0.95 },
  // ~5/64 audited calls are Beyond Finance-branded with zero "Freedom" wording
  { pattern: /thank you for calling beyond finance/i, label: "beyond_finance_greeting", confidence: "high", score: 0.9 },
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
