import { z } from "zod"

// Quote + rationale evidence the LLM cites from the transcript.
export const DispositionEvidenceSchema = z.object({
  speaker: z.string(),
  quote: z.string(),
  rationale: z.string(),
})

// A disposition the LLM considered but did not pick as the primary suggestion.
export const DispositionCandidateSchema = z.object({
  disposition: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
})

// Disposition permission categories. Derived server-side from the taxonomy,
// never trusted from the LLM.
export const DispositionCategorySchema = z.enum([
  "ai_eligible",
  "manager_restricted",
  "end_campaign",
  "unknown",
])

// What the model returns. Pure transcript analysis only — it never decides
// permissions or the recommended action; the module assembles those server-side.
export const DispositionAnalysisSchema = z.object({
  suggested_disposition: z.string().nullable(),
  disposition_matches_transcript: z.boolean(),
  confidence: z.number().min(0).max(1),
  conversation_happened: z.enum(["yes", "no", "unclear"]),
  evidence: z.array(DispositionEvidenceSchema),
  reasoning_summary: z.string(),
  alternative_candidates: z.array(DispositionCandidateSchema),
})

export type DispositionAnalysis = z.infer<typeof DispositionAnalysisSchema>

// Permission block. `can_auto_update` is structurally pinned to false for this
// advisory-only slice — the schema itself rejects any attempt to set it true.
export const DispositionPermissionSchema = z.object({
  category: DispositionCategorySchema,
  can_auto_update: z.literal(false),
  requires_human_review: z.boolean(),
  reason: z.string(),
})

export const RecommendedActionSchema = z.enum([
  "no_change",
  "surface_for_review",
  "eligible_for_future_auto_update",
  "insufficient_evidence",
])

// The full stored contract: LLM analysis + server-assembled current
// disposition, permission, and recommended action.
export const DispositionReviewSchema = z.object({
  current_disposition: z.string().nullable(),
  suggested_disposition: z.string().nullable(),
  disposition_matches_transcript: z.boolean(),
  confidence: z.number().min(0).max(1),
  conversation_happened: z.enum(["yes", "no", "unclear"]),
  evidence: z.array(DispositionEvidenceSchema),
  reasoning_summary: z.string(),
  permission: DispositionPermissionSchema,
  recommended_action: RecommendedActionSchema,
  alternative_candidates: z.array(DispositionCandidateSchema),
})

export type DispositionReviewResult = z.infer<typeof DispositionReviewSchema>
export type DispositionCategory = z.infer<typeof DispositionCategorySchema>
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>
