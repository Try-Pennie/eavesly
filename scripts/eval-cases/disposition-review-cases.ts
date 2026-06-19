// Labeled eval set for the disposition-review module.
//
// Each case pairs a transcript + the CRM's current disposition with the fields
// we can assert ground truth on. The harness only scores fields present in
// `expect`, so a case can assert just the robust signals (e.g. whether a real
// conversation happened) without forcing a brittle suggested-disposition label.
//
// Cases A and B are anchored to the existing response fixtures
// (test/fixtures/responses/disposition-review-{match,mismatch}.json): their
// transcripts embed the exact evidence quotes those fixtures cite, so the
// fixture output is the ground truth. Case E reuses a real transcript fixture.

export type ConversationHappened = "yes" | "no" | "unclear"

export type RecommendedAction =
  | "no_change"
  | "surface_for_review"
  | "eligible_for_future_auto_update"
  | "insufficient_evidence"

export interface EvalCase {
  name: string
  description: string
  currentDisposition: string | null
  /** Inline transcript, or use transcriptFile to load from disk. */
  transcript?: string
  /** Path relative to repo root (takes precedence over transcript). */
  transcriptFile?: string
  /** Only fields present here are scored. */
  expect: {
    conversation_happened?: ConversationHappened
    disposition_matches_transcript?: boolean
    suggested_disposition?: string
    recommended_action?: RecommendedAction
  }
}

export const EVAL_CASES: EvalCase[] = [
  {
    name: "match-not-interested",
    description:
      "Contact plainly declines; CRM already says Not Interested. Anchored to disposition-review-match.json.",
    currentDisposition: "Not Interested",
    transcript: [
      "[handling agent]: Hi, this is Jordan with Pennie on a recorded line. I wanted to follow up on the debt resolution options we sent over.",
      "[contact]: No thanks, I'm really not interested in any of this.",
      "[handling agent]: Understood, I'll take you off the list. Have a good day.",
    ].join("\n"),
    expect: {
      conversation_happened: "yes",
      disposition_matches_transcript: true,
      suggested_disposition: "Not Interested",
      recommended_action: "no_change",
    },
  },
  {
    name: "mismatch-interested-actually-not",
    description:
      "CRM says Interested but contact firmly declines and asks them to stop calling. Anchored to disposition-review-mismatch.json.",
    currentDisposition: "Interested",
    transcript: [
      "[handling agent]: Hi, this is Lamar with Pennie on a recorded line, following up about your loan inquiry.",
      "[contact]: I already told you, please stop calling, I don't want this.",
      "[handling agent]: Okay, understood, I'll note that down.",
    ].join("\n"),
    expect: {
      // recommended_action is intentionally not asserted: ai_eligible mismatch
      // splits between surface_for_review and eligible_for_future_auto_update on
      // the model's confidence (>=0.85), which is exactly what we're measuring.
      conversation_happened: "yes",
      disposition_matches_transcript: false,
      suggested_disposition: "Not Interested",
    },
  },
  {
    name: "voicemail-no-conversation",
    description: "Agent-only voicemail, no contact engagement; CRM says No Action.",
    currentDisposition: "No Action",
    transcript: [
      "[handling agent]: Hi, this is Sam with Pennie on a recorded line calling about your inquiry. Sorry I missed you, please give us a call back at your convenience. Thanks, have a great day.",
    ].join("\n"),
    expect: {
      conversation_happened: "no",
    },
  },
  {
    name: "ambiguous-too-short",
    description:
      "Greeting only, call ends before anything substantive; CRM optimistically says Interested. Model should hedge.",
    currentDisposition: "Interested",
    transcript: [
      "[handling agent]: This is Alex with Pennie on a recorded line. How are you today?",
      "[contact]: Good, thanks.",
      "[handling agent]: Great, I'm calling to follow up on your inquiry. Do you have a few minutes?",
      "[contact]: Sure, go ahead.",
    ].join("\n"),
    expect: {
      // A well-calibrated model returns unclear / low confidence here, which the
      // server maps to insufficient_evidence.
      recommended_action: "insufficient_evidence",
    },
  },
  {
    name: "real-engaged-call",
    description:
      "Full real transcript with a genuine two-way conversation (fixture). Measures behavior + latency/cost on real-size input.",
    currentDisposition: "Interested",
    transcriptFile: "test/fixtures/transcripts/excellent-call.txt",
    expect: {
      conversation_happened: "yes",
    },
  },
]
