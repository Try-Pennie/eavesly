import type {
  PriorProgramExpectationAssessment,
  ProgramExpectationCriterion,
  ProgramExpectationsAssessment,
  ProgramExpectationsResult,
} from "../../schemas/program-expectations"
import { findHandlingAgentEvidence } from "../gota-check/logic"

export const PROGRAM_EXPECTATIONS_RUBRIC_VERSION = "program_expectations_activation_v1"
export const PROGRAM_EXPECTATIONS_EVALUATOR_VERSION = "transcript_resolver_v1"
export const PROGRAM_EXPECTATIONS_LOOKBACK_DAYS = 30
export const PROGRAM_EXPECTATIONS_MAX_PRIOR_CALLS = 5
export const PROGRAM_EXPECTATIONS_MAX_PRIOR_EVALUATIONS = 2

export type PriorTranscriptSource = "regal_event" | "legacy_qa" | "legacy_transcription"

export type PriorProgramExpectationCall = {
  readonly call_id: string
  readonly started_at: string
  readonly agent_email: string | null
  readonly talk_time: number | null
  readonly transcript: string
  readonly transcript_source: PriorTranscriptSource
}

export type PriorProgramExpectationLookup =
  | { readonly status: "none" }
  | {
      readonly status: "needs_review"
      readonly reason: "identity_unproven" | "chronology_unproven" | "dependency_failure"
    }
  | {
      readonly status: "ready"
      readonly lead_id: string
      readonly calls: ReadonlyArray<PriorProgramExpectationCall>
      readonly total_eligible_calls: number
      readonly unavailable_transcript_count: number
    }

const CRITERIA = [
  {
    criterion: "phase_activation",
    covered: "phase_activation_covered",
    evidence: "phase_activation_evidence",
    label: "Phase 1: Activation (Months 1–3)",
  },
  {
    criterion: "phase_traction",
    covered: "phase_traction_covered",
    evidence: "phase_traction_evidence",
    label: "Phase 2: Traction (Months 4–9)",
  },
  {
    criterion: "phase_momentum",
    covered: "phase_momentum_covered",
    evidence: "phase_momentum_evidence",
    label: "Phase 3: Momentum (Months 10–60)",
  },
  {
    criterion: "phase_graduation",
    covered: "phase_graduation_covered",
    evidence: "phase_graduation_evidence",
    label: "Phase 4: Graduation (Months 60+)",
  },
  {
    criterion: "credit_impact_downside",
    covered: "credit_impact_downside_covered",
    evidence: "credit_impact_evidence",
    label: "Downside: credit score may decline",
  },
  {
    criterion: "payments_withheld_downside",
    covered: "payments_withheld_downside_covered",
    evidence: "payments_withheld_evidence",
    label: "Downside: payments are withheld",
  },
  {
    criterion: "accounts_may_close_downside",
    covered: "accounts_may_close_downside_covered",
    evidence: "accounts_may_close_evidence",
    label: "Downside: accounts may close",
  },
  {
    criterion: "adjustment_period_downside",
    covered: "adjustment_period_downside_covered",
    evidence: "adjustment_period_evidence",
    label: "Downside: adjustment period upfront is normal",
  },
] as const satisfies ReadonlyArray<{
  readonly criterion: ProgramExpectationCriterion
  readonly covered: keyof ProgramExpectationsAssessment
  readonly evidence: keyof ProgramExpectationsAssessment
  readonly label: string
}>

/** Hash text for persisted evaluator provenance without retaining transcript content. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Return the criteria positively identified in one transcript-local assessment. */
export function coveredCriteria(
  assessment: ProgramExpectationsAssessment,
): ReadonlyArray<ProgramExpectationCriterion> {
  return CRITERIA.flatMap(({ criterion, covered }) => assessment[covered] === true ? [criterion] : [])
}

/** Return server-owned human labels for requirements missing from one assessment. */
export function missingLabels(assessment: ProgramExpectationsAssessment): ReadonlyArray<string> {
  return CRITERIA.flatMap(({ covered, label }) => assessment[covered] === true ? [] : [label])
}

function missingCriteria(
  assessment: ProgramExpectationsAssessment,
): ReadonlyArray<ProgramExpectationCriterion> {
  return CRITERIA.flatMap(({ criterion, covered }) => assessment[covered] === true ? [] : [criterion])
}

/** Finalize a current-call assessment before any prior-call rescue is attempted. */
export function finalizeCurrentAssessment(
  assessment: ProgramExpectationsAssessment,
  promptSha256: string,
): ProgramExpectationsResult {
  const missing = missingCriteria(assessment)
  const missingElements = missingLabels(assessment)

  if (!assessment.enrollment_completed) {
    return {
      ...assessment,
      missing_elements: [...missingElements],
      prior_call_program_expectations_covered: false,
      prior_call_evidence_quote: "",
      prior_call_assessments: [],
      decision: { status: "not_applicable", reason: "no_enrollment" },
      rubric_version: PROGRAM_EXPECTATIONS_RUBRIC_VERSION,
      evaluator_version: PROGRAM_EXPECTATIONS_EVALUATOR_VERSION,
      prompt_sha256: promptSha256,
      violation: false,
      violation_reason: "Enrollment did not complete on this call.",
    }
  }

  if (missing.length === 0) {
    return {
      ...assessment,
      missing_elements: [],
      prior_call_program_expectations_covered: false,
      prior_call_evidence_quote: "",
      prior_call_assessments: [],
      decision: { status: "no_alert_current_complete" },
      rubric_version: PROGRAM_EXPECTATIONS_RUBRIC_VERSION,
      evaluator_version: PROGRAM_EXPECTATIONS_EVALUATOR_VERSION,
      prompt_sha256: promptSha256,
      violation: false,
      violation_reason: "All four phases and all four required downsides were covered on this call.",
    }
  }

  return {
    ...assessment,
    missing_elements: [...missingElements],
    prior_call_program_expectations_covered: false,
    prior_call_evidence_quote: "",
    prior_call_assessments: [],
    decision: { status: "alert_missing", missing: [...missing] },
    rubric_version: PROGRAM_EXPECTATIONS_RUBRIC_VERSION,
    evaluator_version: PROGRAM_EXPECTATIONS_EVALUATOR_VERSION,
    prompt_sha256: promptSha256,
    violation: true,
    violation_reason: `Enrollment completed, but ${missingElements.join(", ")} were not verified on this call.`,
  }
}

/** Validate all positive model claims against the exact source transcript. */
export async function validatePriorAssessment(
  call: PriorProgramExpectationCall,
  assessment: ProgramExpectationsAssessment,
  currentAgentEmail: string | undefined,
): Promise<PriorProgramExpectationAssessment> {
  const evidence: PriorProgramExpectationAssessment["evidence"][number][] = []
  let evidenceValid = true

  for (const item of CRITERIA) {
    if (assessment[item.covered] !== true) continue
    const quote = assessment[item.evidence]
    if (typeof quote !== "string" || quote.trim().length === 0) {
      evidenceValid = false
      continue
    }
    const found = findHandlingAgentEvidence(quote, call.transcript)
    if (found.position < 0 || found.evidence.length === 0) {
      evidenceValid = false
      continue
    }
    evidence.push({
      criterion: item.criterion,
      quote: found.evidence,
      quote_start: found.position,
      quote_end: found.position + found.evidence.length,
    })
  }

  const covered = coveredCriteria(assessment)
  return {
    source_call_id: call.call_id,
    source_started_at: call.started_at,
    source_agent_email: call.agent_email,
    transcript_source: call.transcript_source,
    transcript_sha256: await sha256Hex(call.transcript),
    same_agent:
      currentAgentEmail !== undefined
      && call.agent_email?.toLowerCase() === currentAgentEmail.toLowerCase(),
    covered_criteria: [...covered],
    evidence,
    complete: covered.length === CRITERIA.length && evidenceValid,
    evidence_valid: evidenceValid,
  }
}

/**
 * Combine current and transcript-verified prior assessments into the only final
 * decision used by storage and alert extraction.
 */
export function resolvePriorAssessments(
  current: ProgramExpectationsResult,
  lookup: PriorProgramExpectationLookup,
  priorAssessments: ReadonlyArray<PriorProgramExpectationAssessment>,
): ProgramExpectationsResult {
  if (current.decision.status !== "alert_missing") return current

  if (lookup.status === "none") return current
  if (lookup.status === "needs_review") {
    return holdForReview(current, lookup.reason, priorAssessments)
  }

  const complete = priorAssessments.find((assessment) => assessment.complete)
  if (complete !== undefined) {
    return {
      ...current,
      prior_call_program_expectations_covered: true,
      prior_call_evidence_quote: complete.evidence[0]?.quote ?? "",
      prior_call_assessments: [...priorAssessments],
      decision: {
        status: "no_alert_prior_complete",
        source_call_id: complete.source_call_id,
        same_agent: complete.same_agent,
      },
      violation: false,
      violation_reason: `Program expectations were verified on prior call ${complete.source_call_id}.`,
    }
  }

  if (priorAssessments.some((assessment) => !assessment.evidence_valid)) {
    return holdForReview(current, "evidence_invalid", priorAssessments)
  }

  const union = new Set<ProgramExpectationCriterion>(coveredCriteria(current))
  for (const assessment of priorAssessments) {
    for (const criterion of assessment.covered_criteria) union.add(criterion)
  }
  if (union.size === CRITERIA.length) {
    return holdForReview(current, "split_coverage", priorAssessments)
  }

  if (lookup.unavailable_transcript_count > 0) {
    return holdForReview(current, "transcript_unavailable", priorAssessments)
  }

  if (lookup.total_eligible_calls > priorAssessments.length) {
    return holdForReview(current, "evaluation_budget_exhausted", priorAssessments)
  }

  return { ...current, prior_call_assessments: [...priorAssessments] }
}

function holdForReview(
  current: ProgramExpectationsResult,
  reason: Extract<ProgramExpectationsResult["decision"], { status: "needs_review" }>["reason"],
  priorAssessments: ReadonlyArray<PriorProgramExpectationAssessment>,
): ProgramExpectationsResult {
  return {
    ...current,
    prior_call_assessments: [...priorAssessments],
    decision: { status: "needs_review", reason },
    violation: false,
    violation_reason: `Program Expectations requires review: ${reason.replace(/_/g, " ")}.`,
  }
}
