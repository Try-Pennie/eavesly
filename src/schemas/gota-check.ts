import { z } from "zod"

/**
 * Achieve GOTA (Going Over The Agreement) check — internal Pennie compliance module.
 *
 * The GOTA is a Pennie-written, page-by-page signing walkthrough of the enrollment
 * agreement, required on every Achieve enrollment before the client proceeds to the
 * welcome call. Two variants exist, both ending in a warm transfer to the welcome team:
 *  - turnbull_red: Turnbull Law Group Client Engagement Packet (legal-model "red" states)
 *  - fdr_green:    Freedom Debt Relief agreement packet ("green" states)
 *
 * The violation (alert) condition is presence-based: the client signed on this call
 * without a guided GOTA walkthrough. Key-beat coverage is informational for coaching
 * and does NOT fire alerts.
 */
export const GotaCheckSchema = z.object({
  enrollment_completed: z.boolean(),
  enrollment_evidence_quote: z.string(),

  gota_conducted: z.boolean(),
  gota_evidence_quote: z.string(),
  gota_type: z.enum(["turnbull_red", "fdr_green", "unknown"]),

  fee_structure_beat_covered: z.boolean(),
  fee_structure_evidence: z.string(),
  cancellation_rights_beat_covered: z.boolean(),
  cancellation_rights_evidence: z.string(),
  do_not_sign_page_beat_covered: z.boolean(),
  do_not_sign_page_evidence: z.string(),
  banking_readback_beat_covered: z.boolean(),
  banking_readback_evidence: z.string(),
  ssn_verification_beat_covered: z.boolean(),
  ssn_verification_evidence: z.string(),
  wc_transfer_brief_beat_covered: z.boolean(),
  wc_transfer_brief_evidence: z.string(),
  missing_beats: z.array(z.string()),

  wc_transfer_occurred: z.boolean(),
  wc_transfer_evidence_quote: z.string(),

  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type GotaCheckResult = z.infer<typeof GotaCheckSchema>
