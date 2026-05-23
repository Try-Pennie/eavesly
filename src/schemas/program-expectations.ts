import { z } from "zod"

export const ProgramExpectationsSchema = z.object({
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

  missing_elements: z.array(z.string()),

  prior_call_program_expectations_covered: z.boolean(),
  prior_call_evidence_quote: z.string(),

  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type ProgramExpectationsResult = z.infer<typeof ProgramExpectationsSchema>
