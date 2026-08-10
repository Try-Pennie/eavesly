import {
  GOTA_SCRIPT_VERSION,
  REQUIRED_DISCLOSURE_KEYS,
  type GotaCheckModelResponse,
  type GotaCheckResult,
  type RequiredDisclosureKey,
} from "../../schemas/gota-check"
import type { LeadContext } from "../../schemas/requests"

/** Stable coaching labels persisted in `missing_required_disclosures`. */
export const REQUIRED_DISCLOSURE_LABELS: Record<RequiredDisclosureKey, string> = {
  program_and_guarantee_limits: "Program type and no-guarantee limits",
  financial_distress_suitability: "Financial-distress suitability",
  creditworthiness_impact: "Adverse creditworthiness impact",
  collections_and_lawsuits_risk: "Collections, lawsuits, fees, penalties, and rates",
  deposit_commitment_and_bankruptcy_alternative: "Deposit commitment and bankruptcy alternative",
  dedicated_account_control: "Client ownership and control of dedicated account",
  performance_based_fees: "Performance-based fee conditions",
  withdrawal_rights: "Withdrawal rights and return of funds",
  tax_consequences: "Tax consequences / IRS reporting",
}

/**
 * Deterministic, provider-neutral completeness anchors for each of the nine
 * required disclosures. `start` captures the required BEGINNING concept and
 * `end` the required ENDING concept; both must appear in the normalized
 * handling-agent evidence before a disclosure can be marked compliant. This
 * blocks a partial quote from passing merely because the model said compliant.
 *
 * Anchors deliberately exclude the FDR/Turnbull provider name so the same rule
 * applies across guide variants (the provider name substitutes freely).
 */
export const DISCLOSURE_COMPLETENESS_ANCHORS: Record<
  RequiredDisclosureKey,
  { start: string; end: string }
> = {
  program_and_guarantee_limits: {
    start: "debt resolution is not a loan",
    end: "within a certain time",
  },
  financial_distress_suitability: {
    start: "suitable only for persons who are in financial distress",
    end: "without hardship",
  },
  creditworthiness_impact: {
    start: "adversely affect your creditworthiness",
    end: "credit bureaus",
  },
  collections_and_lawsuits_risk: {
    start: "collections or lawsuits",
    end: "on your enrolled debts",
  },
  deposit_commitment_and_bankruptcy_alternative: {
    start: "your success depends on your ability to make regular deposits",
    end: "including bankruptcy",
  },
  dedicated_account_control: {
    start: "you own and control the dedicated account",
    end: "services provided",
  },
  performance_based_fees: {
    start: "will not earn and will not be paid",
    end: "payment is made on that settlement",
  },
  withdrawal_rights: {
    start: "you may withdraw from the debt resolution program at any time without penalty",
    end: "not yet been paid",
  },
  tax_consequences: {
    // Numeral-free / ASR-tolerant: "$600" may be rendered as "six hundred
    // dollars" by transcription, so the anchor avoids the amount entirely.
    start: "may report settlement savings",
    end: "taxable income",
  },
}

/** Stable coaching labels persisted in `missing_beats`. */
export const GOTA_BEAT_LABELS = {
  fee_structure: "Fee structure (performance-based fees)",
  cancellation_rights: "Cancellation rights (cancel anytime + applicable state terms)",
  creditor_list: "Creditor list verification",
  dedicated_account: "Dedicated account ownership, independence, and fees",
  banking_confirmation: "Banking details and draft-date confirmation",
  ssn_verification: "SSN and date-of-birth verification",
  do_not_sign_page: "Turnbull cancellation notice (footer only; cancellation line blank)",
  california_followup: "California Day-4 execution follow-up scheduled",
  wc_transfer_brief: "Warm-transfer brief to welcome team",
} as const

type GotaType = GotaCheckModelResponse["gota_type"]

/**
 * Resolves the applicable Achieve guide from deterministic Regal lead metadata.
 * California always wins because its FDR packet uses a distinct two-call signing
 * process. Returns undefined when the metadata cannot decide the guide, in which
 * case the model's transcript-derived gota_type is used.
 *
 * Rule: clientState (trimmed, upper-cased) === "CA" -> fdr_california; else
 * LegalState "yes" -> turnbull_red, "no" -> fdr_green (case-insensitive,
 * trimmed); otherwise undefined.
 */
export function resolveGotaTypeFromLeadContext(
  leadContext: LeadContext | undefined,
): GotaType | undefined {
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
 * violation decisions to a parsed model response. Pure and total: it never
 * throws, and it owns California fail-closed suppression.
 *
 * `resolvedGotaType`, when present, is the deterministic lead-context guide and
 * overrides the model's transcript-derived gota_type.
 */
export function finalizeGotaCheck(
  model: GotaCheckModelResponse,
  transcript: string,
  resolvedGotaType?: GotaType,
): GotaCheckResult {
  const modelGotaType = model.gota_type
  const gotaType = resolvedGotaType ?? modelGotaType

  // 1. Verify each required disclosure against handling-agent speech. A
  //    disclosure is compliant only when the model marked it compliant AND its
  //    evidence is a literal, single-speaker handling-agent transcript substring
  //    AND that evidence contains both the required beginning and ending
  //    completeness anchors (so a partial quote cannot pass).
  const verified = {} as Record<
    RequiredDisclosureKey,
    { compliant: boolean; evidence_quote: string; position: number }
  >
  for (const key of REQUIRED_DISCLOSURE_KEYS) {
    const found = findHandlingAgentEvidence(model.required_disclosures[key].evidence_quote, transcript)
    verified[key] = {
      compliant:
        model.required_disclosures[key].compliant &&
        found.evidence.length > 0 &&
        disclosureIsComplete(key, found.evidence),
      evidence_quote: found.evidence,
      position: found.position,
    }
  }

  const requiredDisclosures = Object.fromEntries(
    REQUIRED_DISCLOSURE_KEYS.map((key) => [
      key,
      { compliant: verified[key].compliant, evidence_quote: verified[key].evidence_quote },
    ]),
  ) as GotaCheckResult["required_disclosures"]

  // 2. Guided walkthrough is server-owned: the handling agent must have real
  //    handling-agent evidence. Transfer/contact-only quotes never satisfy it.
  const gotaEvidence = findHandlingAgentEvidence(model.gota_evidence_quote, transcript).evidence
  const gotaConducted = model.gota_conducted && gotaEvidence.length > 0

  // 3. California detection — ANY signal forces suppression.
  const isCalifornia =
    gotaType === "fdr_california" ||
    modelGotaType === "fdr_california" ||
    model.call_stage === "california_initial_signing" ||
    model.call_stage === "california_day4_execution"

  // 4. The full combined process is required only for a completed standard
  //    signing. Disclosures/beats are surfaced for review on a California
  //    initial signing too, but California never produces a violation.
  const processRequired = model.call_stage === "standard_signing" && model.enrollment_completed
  const disclosuresExpected = processRequired || model.call_stage === "california_initial_signing"

  const inOrder = disclosuresAppearInOrder(verified)
  const allNineCompliant = REQUIRED_DISCLOSURE_KEYS.every((key) => verified[key].compliant)
  const requiredDisclosuresCompliant = disclosuresExpected && allNineCompliant && inOrder
  const missingRequiredDisclosures = disclosuresExpected
    ? REQUIRED_DISCLOSURE_KEYS.flatMap((key) =>
        verified[key].compliant ? [] : [REQUIRED_DISCLOSURE_LABELS[key]],
      )
    : []

  // 5. Coaching beats — informational only. `covered` is downgraded when its
  //    evidence is not literal handling-agent speech, but a missing beat never
  //    creates a violation.
  const beatCovered = {
    fee_structure: verifiedBeatCovered(model.fee_structure_beat_covered, model.fee_structure_evidence, transcript),
    cancellation_rights: verifiedBeatCovered(model.cancellation_rights_beat_covered, model.cancellation_rights_evidence, transcript),
    do_not_sign_page: verifiedBeatCovered(model.do_not_sign_page_beat_covered, model.do_not_sign_page_evidence, transcript),
    creditor_list: verifiedBeatCovered(model.creditor_list_beat_covered, model.creditor_list_evidence, transcript),
    dedicated_account: verifiedBeatCovered(model.dedicated_account_beat_covered, model.dedicated_account_evidence, transcript),
    banking_readback: verifiedBeatCovered(model.banking_readback_beat_covered, model.banking_readback_evidence, transcript),
    ssn_verification: verifiedBeatCovered(model.ssn_verification_beat_covered, model.ssn_verification_evidence, transcript),
    california_followup: verifiedBeatCovered(model.california_followup_beat_covered, model.california_followup_evidence, transcript),
    wc_transfer_brief: verifiedBeatCovered(model.wc_transfer_brief_beat_covered, model.wc_transfer_brief_evidence, transcript),
  }
  const missingBeats = disclosuresExpected
    ? collectMissingBeats(beatCovered, gotaType, model.call_stage)
    : []

  // 6. Violation — California fail-closed always wins.
  let violation: boolean
  let violationReason: string
  if (isCalifornia) {
    violation = false
    violationReason =
      "California GOTA suppressed: California uses a two-call (Day-4) signing process and no reliable Day-4 identifier exists yet, so no GOTA violation is produced. Assessment stored for review."
  } else if (!processRequired) {
    violation = false
    violationReason = nonProcessReason(model.call_stage)
  } else {
    violation = !requiredDisclosuresCompliant || !gotaConducted
    violationReason = standardViolationReason(requiredDisclosuresCompliant, gotaConducted)
  }

  return {
    ...model,
    script_version: GOTA_SCRIPT_VERSION,
    gota_type: gotaType,
    enrollment_evidence_quote: findHandlingAgentEvidence(model.enrollment_evidence_quote, transcript).evidence,
    required_disclosures: requiredDisclosures,
    required_disclosures_in_order: inOrder,
    required_disclosures_compliant: requiredDisclosuresCompliant,
    missing_required_disclosures: missingRequiredDisclosures,
    gota_conducted: gotaConducted,
    gota_evidence_quote: gotaEvidence,
    fee_structure_beat_covered: beatCovered.fee_structure.covered,
    fee_structure_evidence: beatCovered.fee_structure.evidence,
    cancellation_rights_beat_covered: beatCovered.cancellation_rights.covered,
    cancellation_rights_evidence: beatCovered.cancellation_rights.evidence,
    do_not_sign_page_beat_covered: beatCovered.do_not_sign_page.covered,
    do_not_sign_page_evidence: beatCovered.do_not_sign_page.evidence,
    creditor_list_beat_covered: beatCovered.creditor_list.covered,
    creditor_list_evidence: beatCovered.creditor_list.evidence,
    dedicated_account_beat_covered: beatCovered.dedicated_account.covered,
    dedicated_account_evidence: beatCovered.dedicated_account.evidence,
    banking_readback_beat_covered: beatCovered.banking_readback.covered,
    banking_readback_evidence: beatCovered.banking_readback.evidence,
    ssn_verification_beat_covered: beatCovered.ssn_verification.covered,
    ssn_verification_evidence: beatCovered.ssn_verification.evidence,
    california_followup_beat_covered: beatCovered.california_followup.covered,
    california_followup_evidence: beatCovered.california_followup.evidence,
    wc_transfer_brief_beat_covered: beatCovered.wc_transfer_brief.covered,
    wc_transfer_brief_evidence: beatCovered.wc_transfer_brief.evidence,
    missing_beats: missingBeats,
    wc_transfer_occurred: model.wc_transfer_occurred,
    wc_transfer_evidence_quote: findHandlingAgentEvidence(model.wc_transfer_evidence_quote, transcript).evidence,
    violation,
    violation_reason: violationReason,
    key_evidence_quote: findHandlingAgentEvidence(model.key_evidence_quote, transcript).evidence,
  }
}

/**
 * Disclosures are in order only when all nine have a verified handling-agent
 * position and those positions strictly increase. Missing evidence (position
 * -1) or a duplicate/non-increasing position fails order without throwing.
 */
function disclosuresAppearInOrder(
  verified: Record<RequiredDisclosureKey, { position: number }>,
): boolean {
  let previous = -1
  for (const key of REQUIRED_DISCLOSURE_KEYS) {
    const position = verified[key].position
    if (position < 0) return false
    if (position <= previous) return false
    previous = position
  }
  return true
}

function verifiedBeatCovered(
  modelCovered: boolean,
  evidenceQuote: string,
  transcript: string,
): { covered: boolean; evidence: string } {
  const evidence = findHandlingAgentEvidence(evidenceQuote, transcript).evidence
  return { covered: modelCovered && evidence.length > 0, evidence }
}

function collectMissingBeats(
  covered: Record<string, { covered: boolean }>,
  gotaType: GotaType,
  callStage: GotaCheckModelResponse["call_stage"],
): string[] {
  const missing: string[] = []
  if (!covered.fee_structure.covered) missing.push(GOTA_BEAT_LABELS.fee_structure)
  if (!covered.cancellation_rights.covered) missing.push(GOTA_BEAT_LABELS.cancellation_rights)
  if (!covered.creditor_list.covered) missing.push(GOTA_BEAT_LABELS.creditor_list)
  if (!covered.dedicated_account.covered) missing.push(GOTA_BEAT_LABELS.dedicated_account)
  if (!covered.banking_readback.covered) missing.push(GOTA_BEAT_LABELS.banking_confirmation)
  if (!covered.ssn_verification.covered) missing.push(GOTA_BEAT_LABELS.ssn_verification)
  if (gotaType === "turnbull_red" && !covered.do_not_sign_page.covered) {
    missing.push(GOTA_BEAT_LABELS.do_not_sign_page)
  }
  if (callStage === "california_initial_signing" && !covered.california_followup.covered) {
    missing.push(GOTA_BEAT_LABELS.california_followup)
  }
  if (callStage === "standard_signing" && !covered.wc_transfer_brief.covered) {
    missing.push(GOTA_BEAT_LABELS.wc_transfer_brief)
  }
  return missing
}

function nonProcessReason(callStage: GotaCheckModelResponse["call_stage"]): string {
  switch (callStage) {
    case "standard_signing":
      return "Standard signing was not completed on this call, so the combined disclosure and walkthrough requirement does not apply."
    case "unknown":
      return "The signing-related call could not be classified reliably; no violation produced."
    default:
      return "No applicable signing session occurred on this call."
  }
}

function standardViolationReason(disclosuresCompliant: boolean, gotaConducted: boolean): string {
  if (!disclosuresCompliant && !gotaConducted) {
    return "The required verbatim disclosures and guided signing walkthrough were not completed compliantly."
  }
  if (!disclosuresCompliant) {
    return "One or more required disclosures were omitted, paraphrased, or read out of order."
  }
  if (!gotaConducted) {
    return "The required disclosures were completed, but the client signed without a guided signing walkthrough."
  }
  return "All nine required disclosures were read compliantly and the guided signing walkthrough was conducted."
}

/**
 * Verify that `quote` is literal handling-agent speech.
 *
 * A leading speaker label on the model quote is stripped (deliberate
 * normalization). The remaining content must appear as a contiguous substring
 * of the transcript at a position owned by a `[handling agent]:` label. All
 * occurrences are searched, so identical text appearing first under a
 * `[transfer agent]` line and later under `[handling agent]` still counts via
 * the handling occurrence. Quotes present only under `[transfer agent]` or
 * `[contact]` are rejected.
 *
 * Returns the literal transcript content and the position of the earliest
 * qualifying handling-agent occurrence, or empty/-1 when there is no match.
 *
 * Evidence may span CONSECUTIVE [handling agent] turns (so a long disclosure
 * split across two handling-agent lines still matches), but it may never cross
 * into another speaker: a single leading speaker label is stripped (deliberate
 * normalization), the match must be OWNED by a [handling agent] label, and every
 * speaker label embedded inside the matched span must also be [handling agent].
 * A span that includes a [transfer agent], [contact], or any other non-handling
 * label is rejected, so a handling-agent-owned start can never absorb another
 * party's words. Matching stays literal and contiguous.
 */
export function findHandlingAgentEvidence(
  quote: string,
  transcript: string,
): { evidence: string; position: number } {
  const content = quote.replace(/^\s*\[[^\]]+\]\s*:\s*/, "")
  if (content.length === 0) return { evidence: "", position: -1 }

  const labels = collectSpeakerLabels(transcript)
  let from = 0
  while (from <= transcript.length) {
    const index = transcript.indexOf(content, from)
    if (index < 0) break
    const end = index + content.length
    if (ownerIsHandlingAgent(labels, index) && spanHasNoForeignSpeaker(labels, index, end)) {
      return { evidence: content, position: index }
    }
    from = index + 1
  }
  return { evidence: "", position: -1 }
}

/** True when no non-handling speaker label starts inside the [start, end) span. */
function spanHasNoForeignSpeaker(labels: SpeakerLabel[], start: number, end: number): boolean {
  for (const label of labels) {
    if (label.index >= start && label.index < end && !label.isHandlingAgent) return false
  }
  return true
}

interface SpeakerLabel {
  index: number
  isHandlingAgent: boolean
}

function collectSpeakerLabels(transcript: string): SpeakerLabel[] {
  const labels: SpeakerLabel[] = []
  const re = /\[([^\]]+)\]\s*:/g
  let match: RegExpExecArray | null
  while ((match = re.exec(transcript)) !== null) {
    labels.push({ index: match.index, isHandlingAgent: match[1].trim().toLowerCase() === "handling agent" })
  }
  return labels
}

/** The owner of a position is the speaker whose label most recently preceded it. */
function ownerIsHandlingAgent(labels: SpeakerLabel[], position: number): boolean {
  let owner: SpeakerLabel | undefined
  for (const label of labels) {
    if (label.index <= position) owner = label
    else break
  }
  return owner?.isHandlingAgent ?? false
}

/** Lowercase and collapse whitespace for deterministic, punctuation-tolerant anchor matching. */
function normalizeForAnchor(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * A disclosure is complete only when the normalized handling-agent evidence
 * contains BOTH the required beginning and ending completeness anchors. This
 * rejects partial quotes (e.g. only the opening sentence) even when the model
 * claimed the disclosure was compliant.
 */
function disclosureIsComplete(key: RequiredDisclosureKey, evidence: string): boolean {
  const anchors = DISCLOSURE_COMPLETENESS_ANCHORS[key]
  const normalized = normalizeForAnchor(evidence)
  const startIndex = normalized.indexOf(normalizeForAnchor(anchors.start))
  const endIndex = normalized.indexOf(normalizeForAnchor(anchors.end))
  // Both concepts must be present AND the beginning concept must precede the
  // ending concept, so a fragment cannot satisfy the anchors out of order.
  return startIndex !== -1 && endIndex !== -1 && startIndex < endIndex
}
