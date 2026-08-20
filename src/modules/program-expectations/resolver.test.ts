import { describe, expect, it } from "vitest"
import type { ProgramExpectationsAssessment } from "../../schemas/program-expectations"
import { createMockLLM } from "../../../test/helpers/mock-llm"
import { assessProgramExpectationsTranscript } from "./module"
import {
  finalizeCurrentAssessment,
  resolvePriorAssessments,
  validatePriorAssessment,
  type PriorProgramExpectationCall,
} from "./resolver"

const EMPTY_ASSESSMENT: ProgramExpectationsAssessment = {
  enrollment_completed: true,
  enrollment_evidence_quote: "I signed it",
  phase_activation_covered: false,
  phase_activation_evidence: "",
  phase_traction_covered: false,
  phase_traction_evidence: "",
  phase_momentum_covered: false,
  phase_momentum_evidence: "",
  phase_graduation_covered: false,
  phase_graduation_evidence: "",
  credit_impact_downside_covered: false,
  credit_impact_evidence: "",
  payments_withheld_downside_covered: false,
  payments_withheld_evidence: "",
  accounts_may_close_downside_covered: false,
  accounts_may_close_evidence: "",
  adjustment_period_downside_covered: false,
  adjustment_period_evidence: "",
  key_evidence_quote: "",
}

const COMPLETE_PRIOR: ProgramExpectationsAssessment = {
  ...EMPTY_ASSESSMENT,
  enrollment_completed: false,
  enrollment_evidence_quote: "",
  phase_activation_covered: true,
  phase_activation_evidence: "The first three months are activation and your first settlement.",
  phase_traction_covered: true,
  phase_traction_evidence: "Months four through nine are traction when negotiations begin.",
  phase_momentum_covered: true,
  phase_momentum_evidence: "By month ten you hit momentum and balances reach zero.",
  phase_graduation_covered: true,
  phase_graduation_evidence: "Graduation is the finish line with a clean slate.",
  credit_impact_downside_covered: true,
  credit_impact_evidence: "Your credit score may dip at first.",
  payments_withheld_downside_covered: true,
  payments_withheld_evidence: "You stop paying the enrolled creditors directly.",
  accounts_may_close_downside_covered: true,
  accounts_may_close_evidence: "Those enrolled accounts may close.",
  adjustment_period_downside_covered: true,
  adjustment_period_evidence: "That early adjustment is normal and it gets better.",
}

const COMPLETE_PRIOR_REFERENCES: ProgramExpectationsAssessment = {
  ...COMPLETE_PRIOR,
  phase_activation_evidence: "HA-000001",
  phase_traction_evidence: "HA-000002",
  phase_momentum_evidence: "HA-000003",
  phase_graduation_evidence: "HA-000004",
  credit_impact_evidence: "HA-000005",
  payments_withheld_evidence: "HA-000006",
  accounts_may_close_evidence: "HA-000007",
  adjustment_period_evidence: "HA-000008",
  key_evidence_quote: "HA-000001",
}

function transcriptFor(assessment: ProgramExpectationsAssessment): string {
  return [
    assessment.phase_activation_evidence,
    assessment.phase_traction_evidence,
    assessment.phase_momentum_evidence,
    assessment.phase_graduation_evidence,
    assessment.credit_impact_evidence,
    assessment.payments_withheld_evidence,
    assessment.accounts_may_close_evidence,
    assessment.adjustment_period_evidence,
  ].filter(Boolean).map((quote) => `[handling agent]: ${quote}`).join("\n")
}

function priorCall(transcript = transcriptFor(COMPLETE_PRIOR)): PriorProgramExpectationCall {
  return {
    call_id: "first-call",
    started_at: "2026-08-19T20:00:00Z",
    agent_email: "joel@example.com",
    talk_time: 2_940,
    transcript,
    transcript_source: "legacy_qa",
  }
}

function currentCandidate() {
  return finalizeCurrentAssessment(EMPTY_ASSESSMENT, "a".repeat(64))
}

describe("Program Expectations prior-call resolver", () => {
  it("suppresses a Joel-like two-call close only from complete transcript evidence", async () => {
    const call = priorCall()
    const llm = createMockLLM(COMPLETE_PRIOR_REFERENCES)
    const modelAssessment = await assessProgramExpectationsTranscript(
      call.transcript,
      llm as any,
      "prior_coverage",
    )
    const assessment = await validatePriorAssessment(call, modelAssessment, "joel@example.com")
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [call],
      total_eligible_calls: 1,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(false)
    expect(result.prior_call_program_expectations_covered).toBe(true)
    expect(result.decision).toEqual({
      status: "no_alert_prior_complete",
      source_call_id: "first-call",
      same_agent: true,
    })
    expect(result.prior_call_assessments[0]?.evidence).toHaveLength(8)
  })

  it("holds an unknown prior turn reference for review", async () => {
    const call = priorCall()
    const llm = createMockLLM({
      ...COMPLETE_PRIOR_REFERENCES,
      phase_activation_evidence: "HA-999999",
    })
    const modelAssessment = await assessProgramExpectationsTranscript(
      call.transcript,
      llm as any,
      "prior_coverage",
    )
    const assessment = await validatePriorAssessment(call, modelAssessment, "joel@example.com")
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [call],
      total_eligible_calls: 1,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(false)
    expect(result.decision).toEqual({ status: "needs_review", reason: "evidence_invalid" })
  })

  it("keeps a genuine omission alertable after all prior transcripts are assessed", async () => {
    const assessment = await validatePriorAssessment(priorCall("[handling agent]: call me tomorrow"), {
      ...EMPTY_ASSESSMENT,
      enrollment_completed: false,
      enrollment_evidence_quote: "",
    }, "joel@example.com")
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [priorCall()],
      total_eligible_calls: 1,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(true)
    expect(result.decision.status).toBe("alert_missing")
  })

  it("holds hallucinated or wrong-speaker evidence for review", async () => {
    const assessment = await validatePriorAssessment(
      priorCall("[contact]: The first three months are activation and your first settlement."),
      COMPLETE_PRIOR,
      "joel@example.com",
    )
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [priorCall()],
      total_eligible_calls: 1,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(false)
    expect(result.decision).toEqual({ status: "needs_review", reason: "evidence_invalid" })
  })

  it("holds instead of alerting when eligible history could not be fully examined", async () => {
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [],
      total_eligible_calls: 1,
      unavailable_transcript_count: 1,
    }, [])

    expect(result.violation).toBe(false)
    expect(result.decision).toEqual({ status: "needs_review", reason: "transcript_unavailable" })
  })

  it("holds when the evaluation budget leaves eligible prior calls unexamined", async () => {
    const assessment = await validatePriorAssessment(priorCall("[handling agent]: call me tomorrow"), {
      ...EMPTY_ASSESSMENT,
      enrollment_completed: false,
      enrollment_evidence_quote: "",
    }, "joel@example.com")
    const result = resolvePriorAssessments(currentCandidate(), {
      status: "ready",
      lead_id: "lead-1",
      calls: [priorCall()],
      total_eligible_calls: 3,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(false)
    expect(result.decision).toEqual({ status: "needs_review", reason: "evaluation_budget_exhausted" })
  })

  it("accepts a handling-agent occurrence when the contact said the same words first", async () => {
    const repeated = COMPLETE_PRIOR.phase_activation_evidence
    const partial = {
      ...EMPTY_ASSESSMENT,
      enrollment_completed: false,
      enrollment_evidence_quote: "",
      phase_activation_covered: true,
      phase_activation_evidence: repeated,
    }
    const call = priorCall(`[contact]: ${repeated}\n[handling agent]: ${repeated}`)
    const assessment = await validatePriorAssessment(call, partial, "joel@example.com")

    expect(assessment.evidence_valid).toBe(true)
    expect(assessment.evidence[0]?.quote).toBe(repeated)
  })

  it("holds coverage split across calls for policy review", async () => {
    const firstHalf = {
      ...EMPTY_ASSESSMENT,
      enrollment_completed: false,
      enrollment_evidence_quote: "",
      phase_activation_covered: true,
      phase_activation_evidence: COMPLETE_PRIOR.phase_activation_evidence,
      phase_traction_covered: true,
      phase_traction_evidence: COMPLETE_PRIOR.phase_traction_evidence,
      phase_momentum_covered: true,
      phase_momentum_evidence: COMPLETE_PRIOR.phase_momentum_evidence,
      phase_graduation_covered: true,
      phase_graduation_evidence: COMPLETE_PRIOR.phase_graduation_evidence,
    }
    const currentDownsides = {
      ...EMPTY_ASSESSMENT,
      credit_impact_downside_covered: true,
      credit_impact_evidence: COMPLETE_PRIOR.credit_impact_evidence,
      payments_withheld_downside_covered: true,
      payments_withheld_evidence: COMPLETE_PRIOR.payments_withheld_evidence,
      accounts_may_close_downside_covered: true,
      accounts_may_close_evidence: COMPLETE_PRIOR.accounts_may_close_evidence,
      adjustment_period_downside_covered: true,
      adjustment_period_evidence: COMPLETE_PRIOR.adjustment_period_evidence,
    }
    const current = finalizeCurrentAssessment(currentDownsides, "a".repeat(64))
    const call = priorCall(transcriptFor(firstHalf))
    const assessment = await validatePriorAssessment(call, firstHalf, "joel@example.com")
    const result = resolvePriorAssessments(current, {
      status: "ready",
      lead_id: "lead-1",
      calls: [call],
      total_eligible_calls: 1,
      unavailable_transcript_count: 0,
    }, [assessment])

    expect(result.violation).toBe(false)
    expect(result.decision).toEqual({ status: "needs_review", reason: "split_coverage" })
  })
})
