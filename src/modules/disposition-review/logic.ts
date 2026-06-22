import type {
  DispositionAnalysis,
  DispositionCategory,
  DispositionReviewResult,
  RecommendedAction,
} from "../../schemas/disposition-review"

// Below this confidence we treat the analysis as too weak to act on.
const MIN_CONFIDENCE = 0.5
// At/above this confidence an AI-eligible mismatch is flagged as a candidate
// for a *future* auto-update slice (still never auto-updated in this one).
const AUTO_ELIGIBLE_CONFIDENCE = 0.85

// Dispositions Eavesly is allowed to reason about and (in a future slice) set.
const AI_ELIGIBLE = new Set(
  [
    "Do Not Contact",
    "Interested",
    "No Action",
    "Not Interested",
    "Reminder",
    "Reminder Confirmation - No Action",
    "Scheduling",
    "Transfer to Agent",
  ].map((d) => d.toLowerCase()),
)

// Named manager/team-restricted dispositions that aren't numbered.
const MANAGER_RESTRICTED = new Set(
  ["Close - No Action"].map((d) => d.toLowerCase()),
)

/**
 * Classify a disposition into a permission category from the Pennie taxonomy.
 * Deterministic and case/whitespace-insensitive — never trusted from the LLM.
 */
export function categorizeDisposition(
  disposition: string | null | undefined,
): DispositionCategory {
  const value = disposition?.trim()
  if (!value) return "unknown"

  // END CAMPAIGNS outcomes always require human review, regardless of number.
  if (/end campaigns/i.test(value)) return "end_campaign"

  const normalized = value.toLowerCase()
  if (AI_ELIGIBLE.has(normalized)) return "ai_eligible"

  // Numbered dispositions (1.1, 1.1B, 1.9*, 2.0, ...) are manager/team-specific.
  if (/^\d+\.\d/.test(value)) return "manager_restricted"
  if (MANAGER_RESTRICTED.has(normalized)) return "manager_restricted"

  return "unknown"
}

function buildReason(
  category: DispositionCategory,
  action: RecommendedAction,
): string {
  if (action === "insufficient_evidence") {
    return "Insufficient transcript evidence to recommend a disposition change. Advisory only; auto-update is disabled."
  }
  if (action === "no_change") {
    return "Current disposition is consistent with the transcript. Advisory only; auto-update is disabled."
  }
  switch (category) {
    case "end_campaign":
      return "Suggested disposition ends campaigns and must be reviewed by a human. Auto-update is disabled."
    case "manager_restricted":
      return "Suggested disposition is manager/team-restricted and must be reviewed by a human. Auto-update is disabled."
    case "ai_eligible":
      return "Suggested disposition is AI-eligible, but this advisory slice never auto-updates — surfaced for human review."
    default:
      return "Suggested disposition is outside the known taxonomy and must be reviewed by a human. Auto-update is disabled."
  }
}

/**
 * Assemble the full disposition-review contract from the LLM analysis plus the
 * authoritative current disposition (from call metadata, not the LLM).
 *
 * `currentCanonicalConv` is the canonical conversation_happened ("yes"/"no") of
 * the disposition the human applied, read from the live catalog. It drives the
 * high-precision objective gate (see deriveRecommendedAction); null when the
 * current disposition isn't in the catalog or has no canonical value.
 *
 * Hard rule for this slice: `can_auto_update` is ALWAYS false.
 */
export function buildDispositionReview(
  analysis: DispositionAnalysis,
  currentDisposition: string | null,
  currentCanonicalConv: string | null = null,
): DispositionReviewResult {
  const category = categorizeDisposition(
    analysis.suggested_disposition ?? currentDisposition,
  )

  // Objective signal: the model's read of whether a conversation happened
  // contradicts the canonical conversation_happened of the human's disposition
  // (e.g. a voicemail/no-answer tagged as a completed/interested call). This is
  // cheap and high-precision, unlike the model's subjective "I'd relabel this
  // conversation" disagreements, which are noisy and held back from alerting.
  const conversationMismatch =
    currentCanonicalConv != null &&
    analysis.conversation_happened !== "unclear" &&
    analysis.conversation_happened !== currentCanonicalConv

  const action = deriveRecommendedAction(analysis, category, conversationMismatch)
  const hasViolation =
    action === "surface_for_review" || action === "eligible_for_future_auto_update"

  return {
    current_disposition: currentDisposition,
    suggested_disposition: analysis.suggested_disposition,
    disposition_matches_transcript: analysis.disposition_matches_transcript,
    confidence: analysis.confidence,
    conversation_happened: analysis.conversation_happened,
    evidence: analysis.evidence,
    reasoning_summary: analysis.reasoning_summary,
    permission: {
      category,
      can_auto_update: false,
      requires_human_review: hasViolation,
      reason: buildReason(category, action),
    },
    recommended_action: action,
    alternative_candidates: analysis.alternative_candidates,
  }
}

function deriveRecommendedAction(
  analysis: DispositionAnalysis,
  category: DispositionCategory,
  conversationMismatch: boolean,
): RecommendedAction {
  // Too weak to act on: unclear conversation or low confidence.
  if (
    analysis.conversation_happened === "unclear" ||
    analysis.confidence < MIN_CONFIDENCE
  ) {
    return "insufficient_evidence"
  }

  if (analysis.disposition_matches_transcript) return "no_change"

  // High-precision gate: only surface a mismatch when the model's
  // conversation_happened contradicts the disposition's canonical value. A
  // subjective re-label of a call where the conversation status agrees is
  // retained in the result but not surfaced (it is the noisy ~60% bucket).
  if (!conversationMismatch) return "no_change"

  // Mismatch but nothing concrete to suggest.
  if (!analysis.suggested_disposition) return "insufficient_evidence"

  // Mismatch with a concrete suggestion → needs human attention.
  if (
    category === "ai_eligible" &&
    analysis.confidence >= AUTO_ELIGIBLE_CONFIDENCE
  ) {
    return "eligible_for_future_auto_update"
  }
  return "surface_for_review"
}
