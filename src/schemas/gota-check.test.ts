import { describe, it, expect } from "vitest"
import {
  GOTA_SCRIPT_VERSION,
  GotaCheckModelResponseSchema,
  GotaCheckSchema,
  REQUIRED_DISCLOSURE_KEYS,
} from "./gota-check"
import conductedFixture from "../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../test/fixtures/responses/gota-check-partial-beats.json"

describe("GotaCheckSchema", () => {
  it("validates the conducted (no violation) fixture", () => {
    expect(GotaCheckSchema.safeParse(conductedFixture).success).toBe(true)
  })

  it("validates the violation fixture", () => {
    expect(GotaCheckSchema.safeParse(violationFixture).success).toBe(true)
  })

  it("validates the not-enrolled fixture", () => {
    expect(GotaCheckSchema.safeParse(notEnrolledFixture).success).toBe(true)
  })

  it("validates the partial-beats fixture", () => {
    expect(GotaCheckSchema.safeParse(partialBeatsFixture).success).toBe(true)
  })

  it("exposes exactly the nine required disclosure keys in canonical order", () => {
    expect(REQUIRED_DISCLOSURE_KEYS).toEqual([
      "program_and_guarantee_limits",
      "financial_distress_suitability",
      "creditworthiness_impact",
      "collections_and_lawsuits_risk",
      "deposit_commitment_and_bankruptcy_alternative",
      "dedicated_account_control",
      "performance_based_fees",
      "withdrawal_rights",
      "tax_consequences",
    ])
  })

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
    })
    expect(result.call_stage).toBe("california_initial_signing")
    expect(result.gota_type).toBe("fdr_california")
    expect(Object.keys(result.required_disclosures)).toHaveLength(9)
  })

  it("model response schema does not require script_version; persisted schema stamps it", () => {
    const { script_version: _sv, ...withoutVersion } = conductedFixture as Record<string, unknown>
    expect(GotaCheckModelResponseSchema.safeParse(withoutVersion).success).toBe(true)
    // persisted schema requires the exact stamped literal
    expect(GotaCheckSchema.safeParse(withoutVersion).success).toBe(false)
    const stamped = GotaCheckSchema.parse({ ...withoutVersion, script_version: GOTA_SCRIPT_VERSION })
    expect(stamped.script_version).toBe("combined_psc_gota_vf_8_6_26")
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
    expect(GotaCheckSchema.safeParse({ ...conductedFixture, gota_type: "beyond" }).success).toBe(false)
  })

  it("rejects a payload missing the violation flag", () => {
    const { violation: _violation, ...rest } = violationFixture
    expect(GotaCheckSchema.safeParse(rest).success).toBe(false)
  })
})
