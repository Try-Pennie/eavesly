import { z } from "zod"

const EvidenceSchema = z.object({
  speaker: z.string(),
  quote: z.string(),
  context: z.string(),
  process_step: z.enum([
    "Step 1 Agenda Setting",
    "Step 2 Credit Review",
    "Step 3 Agent Inputs",
    "Step 4 Paydown Projections",
    "Step 5 Loan Offers",
    "Step 6 Debt Resolution",
    "Off-Cycle",
  ]),
})

const RedFlagHitSchema = z.object({
  red_flag: z.enum([
    "No credit pull consent",
    "Outcome guarantee",
    "Program misrepresentation",
    "High-pressure tactics",
    "Unresolved customer confusion",
  ]),
  evidence: z.array(EvidenceSchema),
})

const SectionGapReasonSchema = z.object({
  section: z.number().int().min(1).max(6),
  reason: z.string(),
})

const FourPointScale = z.enum(["excellent", "good", "fair", "poor"])
const PassFail = z.enum(["pass", "fail"])
const PassFailNA = z.enum(["pass", "fail", "not_applicable"])
const StepCompletion = z.enum(["complete", "partial", "missing"])
const StepCompletionNA = z.enum(["complete", "partial", "missing", "not_applicable"])

export const WarmTransferSchema = z.object({
  call_overview: z.object({
    pennie_agent_speaker: z.string(),
    customer_speaker: z.string(),
    other_speakers: z.array(z.string()),
    call_topic: z.string(),
    call_purpose: z.string(),
    call_outcome: z.string(),
    overall_tone: z.string(),
    call_duration_assessment: z.enum(["efficient", "appropriate", "too_long"]),
    enrollment_completed: z.boolean(),
    manager_review_required: z.boolean(),
    manager_review_reason: z.string(),
    manager_focus_areas: z.array(EvidenceSchema),
  }),

  compliance_scorecard: z.object({
    call_recording_disclosure: PassFailNA,
    call_recording_disclosure_evidence: z.array(EvidenceSchema),
    credit_pull_consent: PassFailNA,
    credit_pull_consent_evidence: z.array(EvidenceSchema),
    social_security_verification: PassFailNA,
    social_security_verification_evidence: z.array(EvidenceSchema),
    accurate_representations: PassFail,
    accurate_representations_violations: z.array(z.string()),
    critical_red_flag_hits: z.array(RedFlagHitSchema),
    no_misleading_claims: PassFail,
    misleading_claims_violations: z.array(z.string()),
    overall_compliance_score: PassFail,
    compliance_violations: z.array(z.string()),
    critical_moments: z.array(z.string()),
  }),

  customer_experience_scorecard: z.object({
    professional_tone: FourPointScale,
    professional_tone_examples: z.array(z.string()),
    active_listening: FourPointScale,
    active_listening_examples: z.array(z.string()),
    patience_empathy: FourPointScale,
    patience_empathy_examples: z.array(z.string()),
    clear_communication: FourPointScale,
    clear_communication_examples: z.array(z.string()),
    customer_focused: FourPointScale,
    customer_focused_examples: z.array(z.string()),
    overall_customer_experience: FourPointScale,
    customer_experience_notes: z.string(),
    notable_interactions: z.array(z.string()),
  }),

  sales_process_scorecard: z.object({
    expected_sections: z.array(z.number().int().min(1).max(6)),
    sections_attempted: z.array(z.number().int().min(1).max(6)),
    sections_completed: z.array(z.number().int().min(1).max(6)),
    step1_agenda_setting: StepCompletion,
    step1_location: z.string().nullable(),
    step2_credit_review: StepCompletionNA,
    step2_location: z.string().nullable(),
    step3_agent_inputs: StepCompletion,
    step3_location: z.string().nullable(),
    step4_paydown_projections: StepCompletionNA,
    step4_location: z.string().nullable(),
    step5_offers_review: StepCompletionNA,
    step5_location: z.string().nullable(),
    step6_debt_resolution: StepCompletionNA,
    step6_location: z.string().nullable(),
    overall_process_adherence: FourPointScale,
    missed_opportunities: z.array(z.string()),
    process_notes: z.string(),
    section_gap_reasons: z.array(SectionGapReasonSchema),
    key_process_moments: z.array(z.string()),
  }),

  transfer_agent_assessment: z.object({
    transfer_occurred: z.boolean(),
    transfer_agent_tone: z.enum(["professional", "unprofessional", "not_applicable"]),
    transfer_quality: z.string(),
  }),

  warm_transfer_compliance: z.object({
    enrollment_completed: z.boolean(),
    warm_transfer_completed: z.boolean(),
    welcome_call_scheduled: z.boolean(),
    client_proactively_requested_scheduling: z.boolean(),
    warm_transfer_violation: z.boolean(),
    violation_reason: z.string(),
    key_evidence_quote: z.string(),
  }),

  coaching_recommendations: z.object({
    strengths: z.array(z.string()),
    areas_for_improvement: z.array(z.string()),
    specific_coaching_points: z.array(z.string()),
    training_recommendations: z.array(z.string()),
  }),

  overall_call_rating: z.object({
    compliance_rating: PassFail,
    sales_effectiveness: FourPointScale,
    customer_satisfaction_likely: z.enum(["high", "medium", "low"]),
    overall_score: z.enum(["excellent", "good", "needs_improvement", "poor"]),
  }),
})

export type WarmTransferResult = z.infer<typeof WarmTransferSchema>
