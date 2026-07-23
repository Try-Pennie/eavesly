import type { GotaCheckResult } from "../../schemas/gota-check"

/** Stable coaching labels persisted in `missing_beats`. */
export const GOTA_BEAT_LABELS = {
  fee_structure: "Fee structure (performance-based fees)",
  cancellation_rights: "Cancellation rights (cancel window + cancel anytime)",
  do_not_sign_page: "Cancellation notice DO-NOT-SIGN page",
  banking_readback: "Banking details read-back",
  ssn_verification: "SSN verification",
  wc_transfer_brief: "Warm-transfer brief to welcome team",
} as const

/**
 * Applies server-owned GOTA decisions to a parsed model response. The model may
 * suggest `missing_beats` and `violation`, but only the per-beat flags and the
 * signed-without-walkthrough invariant determine the persisted values.
 */
export function finalizeGotaCheck(
  result: GotaCheckResult,
  transcript: string,
): GotaCheckResult {
  const missingBeats: string[] = []
  if (!result.fee_structure_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.fee_structure)
  if (!result.cancellation_rights_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.cancellation_rights)
  if (!result.do_not_sign_page_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.do_not_sign_page)
  if (!result.banking_readback_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.banking_readback)
  if (!result.ssn_verification_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.ssn_verification)
  if (!result.wc_transfer_brief_beat_covered) missingBeats.push(GOTA_BEAT_LABELS.wc_transfer_brief)

  return {
    ...result,
    enrollment_evidence_quote: literalEvidence(result.enrollment_evidence_quote, transcript),
    gota_evidence_quote: literalEvidence(result.gota_evidence_quote, transcript),
    fee_structure_evidence: literalEvidence(result.fee_structure_evidence, transcript),
    cancellation_rights_evidence: literalEvidence(result.cancellation_rights_evidence, transcript),
    do_not_sign_page_evidence: literalEvidence(result.do_not_sign_page_evidence, transcript),
    banking_readback_evidence: literalEvidence(result.banking_readback_evidence, transcript),
    ssn_verification_evidence: literalEvidence(result.ssn_verification_evidence, transcript),
    wc_transfer_brief_evidence: literalEvidence(result.wc_transfer_brief_evidence, transcript),
    wc_transfer_evidence_quote: literalEvidence(result.wc_transfer_evidence_quote, transcript),
    key_evidence_quote: literalEvidence(result.key_evidence_quote, transcript),
    missing_beats: missingBeats,
    violation: result.enrollment_completed && !result.gota_conducted,
  }
}

function literalEvidence(quote: string, transcript: string): string {
  if (quote.length === 0 || transcript.includes(quote)) return quote

  // Models sometimes prepend a real speaker label to a verbatim excerpt from
  // later in that speaker's utterance. Removing only that synthetic prefix
  // preserves the useful evidence while guaranteeing the stored value occurs
  // literally in the transcript.
  const withoutSpeakerLabel = quote.replace(/^\[[^\]]+\]:\s*/, "")
  return withoutSpeakerLabel !== quote && transcript.includes(withoutSpeakerLabel)
    ? withoutSpeakerLabel
    : ""
}
