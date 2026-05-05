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

  payments_mechanics_point_covered: z.boolean(),
  payments_mechanics_point_evidence: z.string(),
  payments_withheld_point_covered: z.boolean(),
  payments_withheld_point_evidence: z.string(),

  missing_elements: z.array(z.string()),

  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type ProgramExpectationsResult = z.infer<typeof ProgramExpectationsSchema>
