import { z } from "zod"

/** Script identifier stamped onto every result produced from the vF 8.6.26 guides. */
export const GOTA_SCRIPT_VERSION = "combined_psc_gota_vf_8_6_26" as const

/** Stable keys for the nine red, must-be-verbatim disclosures in Section 2. */
export const REQUIRED_DISCLOSURE_KEYS = [
  "program_and_guarantee_limits",
  "financial_distress_suitability",
  "creditworthiness_impact",
  "collections_and_lawsuits_risk",
  "deposit_commitment_and_bankruptcy_alternative",
  "dedicated_account_control",
  "performance_based_fees",
  "withdrawal_rights",
  "tax_consequences",
] as const

const DisclosureAssessmentSchema = z.object({
  compliant: z.boolean(),
  evidence_quote: z.string(),
})

const RequiredDisclosuresSchema = z.object({
  program_and_guarantee_limits: DisclosureAssessmentSchema,
  financial_distress_suitability: DisclosureAssessmentSchema,
  creditworthiness_impact: DisclosureAssessmentSchema,
  collections_and_lawsuits_risk: DisclosureAssessmentSchema,
  deposit_commitment_and_bankruptcy_alternative: DisclosureAssessmentSchema,
  dedicated_account_control: DisclosureAssessmentSchema,
  performance_based_fees: DisclosureAssessmentSchema,
  withdrawal_rights: DisclosureAssessmentSchema,
  tax_consequences: DisclosureAssessmentSchema,
})

/**
 * Structured model output for the combined disclosure and signing-guide check.
 * Server-owned fields such as script version are added after model evaluation.
 */
export const GotaCheckModelResponseSchema = z.object({
  call_stage: z.enum([
    "not_applicable",
    "standard_signing",
    "california_initial_signing",
    "california_day4_execution",
    "unknown",
  ]),

  enrollment_completed: z.boolean(),
  enrollment_evidence_quote: z.string(),

  required_disclosures: RequiredDisclosuresSchema,
  required_disclosures_in_order: z.boolean(),
  required_disclosures_compliant: z.boolean(),
  missing_required_disclosures: z.array(z.string()),

  gota_conducted: z.boolean(),
  gota_evidence_quote: z.string(),
  gota_type: z.enum(["turnbull_red", "fdr_green", "fdr_california", "unknown"]),

  fee_structure_beat_covered: z.boolean(),
  fee_structure_evidence: z.string(),
  cancellation_rights_beat_covered: z.boolean(),
  cancellation_rights_evidence: z.string(),
  do_not_sign_page_beat_covered: z.boolean(),
  do_not_sign_page_evidence: z.string(),
  creditor_list_beat_covered: z.boolean(),
  creditor_list_evidence: z.string(),
  dedicated_account_beat_covered: z.boolean(),
  dedicated_account_evidence: z.string(),
  banking_readback_beat_covered: z.boolean(),
  banking_readback_evidence: z.string(),
  ssn_verification_beat_covered: z.boolean(),
  ssn_verification_evidence: z.string(),
  california_followup_beat_covered: z.boolean(),
  california_followup_evidence: z.string(),
  wc_transfer_brief_beat_covered: z.boolean(),
  wc_transfer_brief_evidence: z.string(),
  missing_beats: z.array(z.string()),

  wc_transfer_occurred: z.boolean(),
  wc_transfer_evidence_quote: z.string(),

  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

/** Persisted GOTA result after server-owned decisions and version stamping. */
export const GotaCheckSchema = GotaCheckModelResponseSchema.extend({
  script_version: z.literal(GOTA_SCRIPT_VERSION),
})

/** Model-returned assessment before server-owned finalization. */
export type GotaCheckModelResponse = z.infer<typeof GotaCheckModelResponseSchema>

/** Persisted combined disclosure and GOTA assessment. */
export type GotaCheckResult = z.infer<typeof GotaCheckSchema>
