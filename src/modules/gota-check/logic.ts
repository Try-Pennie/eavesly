import {
  GOTA_SCRIPT_VERSION,
  REQUIRED_DISCLOSURE_KEYS,
  type GotaCheckModelResponse,
  type GotaCheckResult,
} from "../../schemas/gota-check"
import type { EvaluateRequest } from "../../schemas/requests"

/** Stable coaching labels persisted in `missing_required_disclosures`. */
export const REQUIRED_DISCLOSURE_LABELS = {
  program_and_guarantee_limits: "Program type and no-guarantee limits",
  financial_distress_suitability: "Financial-distress suitability",
  creditworthiness_impact: "Adverse creditworthiness impact",
  collections_and_lawsuits_risk: "Collections, lawsuits, fees, penalties, and rates",
  deposit_commitment_and_bankruptcy_alternative: "Deposit commitment and bankruptcy alternative",
  dedicated_account_control: "Client ownership and control of dedicated account",
  performance_based_fees: "Performance-based fee conditions",
  withdrawal_rights: "Withdrawal rights and return of funds",
  tax_consequences: "Tax consequences / IRS reporting",
} as const

/** Stable coaching labels persisted in `missing_beats`. */
export const GOTA_BEAT_LABELS = {
  fee_structure: "Fee structure (performance-based fees)",
  cancellation_rights: "Cancellation rights (cancel anytime + applicable state terms)",
  do_not_sign_page: "Turnbull cancellation notice (footer only; cancellation line blank)",
  creditor_list: "Creditor list verification",
  dedicated_account: "Dedicated account ownership, independence, and fees",
  banking_confirmation: "Banking details and draft-date confirmation",
  ssn_verification: "SSN and date-of-birth verification",
  california_followup: "California Day-4 execution follow-up scheduled",
  wc_transfer_brief: "Warm-transfer brief to welcome team",
} as const

/**
 * Resolves the applicable guide from Regal lead metadata. California always
 * wins because its FDR packet has a distinct two-call signing process.
 */
export function resolveGotaTypeFromLeadContext(
  leadContext: EvaluateRequest["lead_context"],
): GotaCheckModelResponse["gota_type"] | undefined {
  if (leadContext?.client_state?.trim().toUpperCase() === "CA") {
    return "fdr_california"
  }

  const legalState = leadContext?.legal_state?.trim().toLowerCase()
  if (legalState === "yes") return "turnbull_red"
  if (legalState === "no") return "fdr_green"
  return undefined
}

/**
 * Applies server-owned disclosure, walkthrough, applicability, evidence, and
 * violation decisions to a parsed model response.
 */
export function finalizeGotaCheck(
  result: GotaCheckModelResponse,
  transcript: string,
  expectedGotaType?: GotaCheckModelResponse["gota_type"],
): GotaCheckResult {
  const gotaType = expectedGotaType ?? result.gota_type
  const requiredDisclosures = {
    program_and_guarantee_limits: verifiedDisclosure(
      result.required_disclosures.program_and_guarantee_limits,
      transcript,
    ),
    financial_distress_suitability: verifiedDisclosure(
      result.required_disclosures.financial_distress_suitability,
      transcript,
    ),
    creditworthiness_impact: verifiedDisclosure(
      result.required_disclosures.creditworthiness_impact,
      transcript,
    ),
    collections_and_lawsuits_risk: verifiedDisclosure(
      result.required_disclosures.collections_and_lawsuits_risk,
      transcript,
    ),
    deposit_commitment_and_bankruptcy_alternative: verifiedDisclosure(
      result.required_disclosures.deposit_commitment_and_bankruptcy_alternative,
      transcript,
    ),
    dedicated_account_control: verifiedDisclosure(
      result.required_disclosures.dedicated_account_control,
      transcript,
    ),
    performance_based_fees: verifiedDisclosure(
      result.required_disclosures.performance_based_fees,
      transcript,
    ),
    withdrawal_rights: verifiedDisclosure(
      result.required_disclosures.withdrawal_rights,
      transcript,
    ),
    tax_consequences: verifiedDisclosure(
      result.required_disclosures.tax_consequences,
      transcript,
    ),
  }

  const processRequired =
    (result.call_stage === "standard_signing" && result.enrollment_completed) ||
    result.call_stage === "california_initial_signing"

  const missingRequiredDisclosures = processRequired
    ? REQUIRED_DISCLOSURE_KEYS.flatMap((key) =>
        requiredDisclosures[key].compliant ? [] : [REQUIRED_DISCLOSURE_LABELS[key]],
      )
    : []
  const requiredDisclosuresInOrder = disclosuresAppearInOrder(requiredDisclosures, transcript)
  const requiredDisclosuresCompliant =
    processRequired &&
    missingRequiredDisclosures.length === 0 &&
    requiredDisclosuresInOrder

  const missingBeats = processRequired ? collectMissingBeats(result, gotaType) : []
  const violation = processRequired && (!requiredDisclosuresCompliant || !result.gota_conducted)

  return {
    ...result,
    script_version: GOTA_SCRIPT_VERSION,
    gota_type: gotaType,
    required_disclosures: requiredDisclosures,
    required_disclosures_in_order: requiredDisclosuresInOrder,
    required_disclosures_compliant: requiredDisclosuresCompliant,
    missing_required_disclosures: missingRequiredDisclosures,
    enrollment_evidence_quote: literalEvidence(result.enrollment_evidence_quote, transcript),
    gota_evidence_quote: literalEvidence(result.gota_evidence_quote, transcript),
    fee_structure_evidence: literalEvidence(result.fee_structure_evidence, transcript),
    cancellation_rights_evidence: literalEvidence(result.cancellation_rights_evidence, transcript),
    do_not_sign_page_evidence: literalEvidence(result.do_not_sign_page_evidence, transcript),
    creditor_list_evidence: literalEvidence(result.creditor_list_evidence, transcript),
    dedicated_account_evidence: literalEvidence(result.dedicated_account_evidence, transcript),
    banking_readback_evidence: literalEvidence(result.banking_readback_evidence, transcript),
    ssn_verification_evidence: literalEvidence(result.ssn_verification_evidence, transcript),
    california_followup_evidence: literalEvidence(result.california_followup_evidence, transcript),
    wc_transfer_brief_evidence: literalEvidence(result.wc_transfer_brief_evidence, transcript),
    wc_transfer_evidence_quote: literalEvidence(result.wc_transfer_evidence_quote, transcript),
    key_evidence_quote: literalEvidence(result.key_evidence_quote, transcript),
    missing_beats: missingBeats,
    violation,
    violation_reason: violationReason({
      processRequired,
      callStage: result.call_stage,
      requiredDisclosuresCompliant,
      gotaConducted: result.gota_conducted,
    }),
  }
}

function verifiedDisclosure(
  assessment: GotaCheckModelResponse["required_disclosures"][keyof GotaCheckModelResponse["required_disclosures"]],
  transcript: string,
) {
  const evidenceQuote = literalEvidence(assessment.evidence_quote, transcript)
  return {
    compliant: assessment.compliant && evidenceQuote.length > 0,
    evidence_quote: evidenceQuote,
  }
}

function disclosuresAppearInOrder(
  disclosures: GotaCheckResult["required_disclosures"],
  transcript: string,
): boolean {
  let previousPosition = -1
  for (const key of REQUIRED_DISCLOSURE_KEYS) {
    const quote = disclosures[key].evidence_quote
    if (quote.length === 0) return false

    const position = transcript.indexOf(quote)
    if (position <= previousPosition) return false
    previousPosition = position
  }
  return true
}

function collectMissingBeats(
  result: GotaCheckModelResponse,
  gotaType: GotaCheckModelResponse["gota_type"],
): string[] {
  const missing: string[] = []
  if (!result.fee_structure_beat_covered) missing.push(GOTA_BEAT_LABELS.fee_structure)
  if (!result.cancellation_rights_beat_covered) missing.push(GOTA_BEAT_LABELS.cancellation_rights)
  if (!result.creditor_list_beat_covered) missing.push(GOTA_BEAT_LABELS.creditor_list)
  if (!result.dedicated_account_beat_covered) missing.push(GOTA_BEAT_LABELS.dedicated_account)
  if (!result.banking_readback_beat_covered) missing.push(GOTA_BEAT_LABELS.banking_confirmation)
  if (!result.ssn_verification_beat_covered) missing.push(GOTA_BEAT_LABELS.ssn_verification)

  if (gotaType === "turnbull_red" && !result.do_not_sign_page_beat_covered) {
    missing.push(GOTA_BEAT_LABELS.do_not_sign_page)
  }
  if (result.call_stage === "california_initial_signing" && !result.california_followup_beat_covered) {
    missing.push(GOTA_BEAT_LABELS.california_followup)
  }
  if (result.call_stage === "standard_signing" && !result.wc_transfer_brief_beat_covered) {
    missing.push(GOTA_BEAT_LABELS.wc_transfer_brief)
  }

  return missing
}

function violationReason(input: {
  readonly processRequired: boolean
  readonly callStage: GotaCheckModelResponse["call_stage"]
  readonly requiredDisclosuresCompliant: boolean
  readonly gotaConducted: boolean
}): string {
  if (!input.processRequired) {
    return input.callStage === "california_day4_execution"
      ? "California Day-4 execution call; the combined disclosure and guided walkthrough belong to the initial signing call."
      : "No applicable signing session occurred on this call."
  }
  if (!input.requiredDisclosuresCompliant && !input.gotaConducted) {
    return "The required verbatim disclosures and guided signing walkthrough were not completed compliantly."
  }
  if (!input.requiredDisclosuresCompliant) {
    return "One or more required disclosures were omitted, paraphrased, or read out of order."
  }
  if (!input.gotaConducted) {
    return "The required disclosures were completed, but the client signed without a guided signing walkthrough."
  }
  return "All nine required disclosures were read compliantly and the guided signing walkthrough was conducted."
}

function literalEvidence(quote: string, transcript: string): string {
  if (quote.length === 0 || transcript.includes(quote)) return quote

  const withoutSpeakerLabel = quote.replace(/^\[[^\]]+\]:\s*/, "")
  return withoutSpeakerLabel !== quote && transcript.includes(withoutSpeakerLabel)
    ? withoutSpeakerLabel
    : ""
}
