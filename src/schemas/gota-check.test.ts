import { describe, it, expect } from "vitest"
import {
  GOTA_SCRIPT_VERSION,
  GotaCheckModelResponseSchema,
  GotaCheckSchema,
} from "./gota-check"
import conductedFixture from "../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../test/fixtures/responses/gota-check-partial-beats.json"

describe("GotaCheckSchema", () => {
  it("models the California initial-signing stage and all nine required disclosures", () => {
    const disclosure = { compliant: true, evidence_quote: "verbatim disclosure" }
    const result = GotaCheckModelResponseSchema.parse({
      ...conductedFixture,
      call_stage: "california_initial_signing",
      gota_type: "fdr_california",
      required_disclosures: {
        program_and_guarantee_limits: disclosure,
        financial_distress_suitability: disclosure,
        creditworthiness_impact: disclosure,
        collections_and_lawsuits_risk: disclosure,
        deposit_commitment_and_bankruptcy_alternative: disclosure,
        dedicated_account_control: disclosure,
        performance_based_fees: disclosure,
        withdrawal_rights: disclosure,
        tax_consequences: disclosure,
      },
      required_disclosures_in_order: true,
      required_disclosures_compliant: true,
      missing_required_disclosures: [],
      creditor_list_beat_covered: true,
      creditor_list_evidence: "creditor list",
      dedicated_account_beat_covered: true,
      dedicated_account_evidence: "dedicated account",
      california_followup_beat_covered: true,
      california_followup_evidence: "follow-up in three days",
    })

    expect(result.call_stage).toBe("california_initial_signing")
    expect(result.gota_type).toBe("fdr_california")
    expect(Object.keys(result.required_disclosures)).toHaveLength(9)
    expect(GotaCheckSchema.parse({ ...result, script_version: GOTA_SCRIPT_VERSION }).script_version)
      .toBe("combined_psc_gota_vf_8_6_26")
  })
  it("validates the conducted (no violation) fixture", () => {
    const result = GotaCheckSchema.safeParse(conductedFixture)
    expect(result.success).toBe(true)
  })

  it("validates the violation fixture", () => {
    const result = GotaCheckSchema.safeParse(violationFixture)
    expect(result.success).toBe(true)
  })

  it("validates the not-enrolled fixture", () => {
    const result = GotaCheckSchema.safeParse(notEnrolledFixture)
    expect(result.success).toBe(true)
  })

  it("validates the partial-beats fixture", () => {
    const result = GotaCheckSchema.safeParse(partialBeatsFixture)
    expect(result.success).toBe(true)
  })

  it("conducted fixture identifies the FDR green-state agreement", () => {
    const parsed = GotaCheckSchema.parse(conductedFixture)
    expect(parsed.gota_type).toBe("fdr_green")
    expect(parsed.gota_conducted).toBe(true)
    expect(parsed.violation).toBe(false)
  })

  it("partial-beats fixture identifies the Turnbull red-state agreement", () => {
    const parsed = GotaCheckSchema.parse(partialBeatsFixture)
    expect(parsed.gota_type).toBe("turnbull_red")
    expect(parsed.gota_conducted).toBe(true)
  })

  it("rejects an unknown gota_type value", () => {
    const result = GotaCheckSchema.safeParse({ ...conductedFixture, gota_type: "beyond" })
    expect(result.success).toBe(false)
  })

  it("rejects a payload missing the violation flag", () => {
    const { violation: _violation, ...rest } = violationFixture
    const result = GotaCheckSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
