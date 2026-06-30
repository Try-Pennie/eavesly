// Deterministic segmentation for Achieve/FDR welcome-call QA.
//
// A full transcript may include Pennie enrollment/disclosure before the actual
// FDR welcome-call coordinator (client success advocate) joins. We only want to
// grade the post-handoff coordinator segment, so we locate the handoff using
// robust textual markers and return everything from that line onward.
//
// ponytail: line-by-line regex scan, earliest-matching line wins. Good enough for
// speaker-per-line transcripts; revisit only if markers start spanning lines.

export type SegmentationConfidence = "high" | "medium" | "low"

export interface WelcomeCallSegment {
  segment: string
  start_line: number
  marker: string | null
  segmentation_confidence: SegmentationConfidence
  segmentation_score: number
  used_full_transcript_fallback: boolean
}

const MARKERS: { pattern: RegExp; label: string; confidence: "high" | "medium"; score: number }[] = [
  { pattern: /thank you for calling[^\n]{0,40}welcome call/i, label: "welcome_call_greeting", confidence: "high", score: 0.95 },
  { pattern: /freedom debt relief client dashboard app/i, label: "fdr_dashboard_app", confidence: "high", score: 0.9 },
  { pattern: /log\s?in to your client dashboard/i, label: "client_dashboard_login", confidence: "high", score: 0.9 },
  { pattern: /client success advocate/i, label: "client_success_advocate", confidence: "high", score: 0.85 },
  // Coordinator-style handoff ("I have Max on the line", "I've got Dana on the line")
  { pattern: /i('ve| have| have got| got)\s+\w+\s+on the line/i, label: "coordinator_handoff", confidence: "medium", score: 0.6 },
]

export function segmentWelcomeCall(transcript: string): WelcomeCallSegment {
  const lines = transcript.split("\n")

  for (let i = 0; i < lines.length; i++) {
    for (const m of MARKERS) {
      if (m.pattern.test(lines[i])) {
        return {
          segment: lines.slice(i).join("\n").trim(),
          start_line: i,
          marker: m.label,
          segmentation_confidence: m.confidence,
          segmentation_score: m.score,
          used_full_transcript_fallback: false,
        }
      }
    }
  }

  // No handoff marker found: fall back to the full transcript but flag low confidence
  // so the LLM (and downstream consumers) know the segment boundary is unreliable.
  return {
    segment: transcript,
    start_line: 0,
    marker: null,
    segmentation_confidence: "low",
    segmentation_score: 0.2,
    used_full_transcript_fallback: true,
  }
}
