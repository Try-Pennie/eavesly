import { z } from "zod"

/** Stable names for the eight Program Expectations requirements. */
export const ProgramExpectationCriterionSchema = z.enum([
  "phase_activation",
  "phase_traction",
  "phase_momentum",
  "phase_graduation",
  "credit_impact_downside",
  "payments_withheld_downside",
  "accounts_may_close_downside",
  "adjustment_period_downside",
])

/** Transcript-local model output. Final alert decisions are computed by the server. */
export const ProgramExpectationsAssessmentSchema = z.object({
  enrollment_completed: z.boolean(),
  enrollment_evidence_quote: z.string(),

  phase_activation_covered: z.boolean(),
  phase_activation_evidence: z.string(),
  phase_traction_covered: z.boolean(),
  phase_traction_evidence: z.string(),
  phase_momentum_covered: z.boolean(),
  phase_momentum_evidence: z.string(),
  phase_graduation_covered: z.boolean(),
  phase_graduation_evidence: z.string(),

  credit_impact_downside_covered: z.boolean(),
  credit_impact_evidence: z.string(),
  payments_withheld_downside_covered: z.boolean(),
  payments_withheld_evidence: z.string(),
  accounts_may_close_downside_covered: z.boolean(),
  accounts_may_close_evidence: z.string(),
  adjustment_period_downside_covered: z.boolean(),
  adjustment_period_evidence: z.string(),

  key_evidence_quote: z.string(),
})

export const ProgramExpectationDecisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_applicable"), reason: z.literal("no_enrollment") }),
  z.object({ status: z.literal("no_alert_current_complete") }),
  z.object({
    status: z.literal("no_alert_prior_complete"),
    source_call_id: z.string(),
    same_agent: z.boolean(),
  }),
  z.object({
    status: z.literal("alert_missing"),
    missing: z.array(ProgramExpectationCriterionSchema),
  }),
  z.object({
    status: z.literal("needs_review"),
    reason: z.enum([
      "identity_unproven",
      "chronology_unproven",
      "transcript_unavailable",
      "evidence_invalid",
      "evaluation_budget_exhausted",
      "split_coverage",
      "dependency_failure",
    ]),
  }),
])

export const ProgramExpectationEvidenceSchema = z.object({
  criterion: ProgramExpectationCriterionSchema,
  quote: z.string().min(1),
  quote_start: z.number().int().nonnegative(),
  quote_end: z.number().int().positive(),
})

export const PriorProgramExpectationAssessmentSchema = z.object({
  source_call_id: z.string(),
  source_started_at: z.string(),
  source_agent_email: z.string().nullable(),
  transcript_source: z.enum(["regal_event", "legacy_qa", "legacy_transcription"]),
  transcript_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  same_agent: z.boolean(),
  covered_criteria: z.array(ProgramExpectationCriterionSchema),
  evidence: z.array(ProgramExpectationEvidenceSchema),
  complete: z.boolean(),
  evidence_valid: z.boolean(),
})

/** Persisted module result with server-owned decision and prior-call provenance. */
export const ProgramExpectationsSchema = ProgramExpectationsAssessmentSchema.extend({
  missing_elements: z.array(z.string()),
  prior_call_program_expectations_covered: z.boolean(),
  prior_call_evidence_quote: z.string(),
  prior_call_assessments: z.array(PriorProgramExpectationAssessmentSchema),
  decision: ProgramExpectationDecisionSchema,
  rubric_version: z.string(),
  evaluator_version: z.string(),
  prompt_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  violation: z.boolean(),
  violation_reason: z.string(),
})

export type ProgramExpectationCriterion = z.infer<typeof ProgramExpectationCriterionSchema>
export type ProgramExpectationsAssessment = z.infer<typeof ProgramExpectationsAssessmentSchema>
export type ProgramExpectationDecision = z.infer<typeof ProgramExpectationDecisionSchema>
export type PriorProgramExpectationAssessment = z.infer<typeof PriorProgramExpectationAssessmentSchema>
export type ProgramExpectationsResult = z.infer<typeof ProgramExpectationsSchema>
