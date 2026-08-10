import { describe, it, expect } from "vitest"
import { GotaCheckSchema } from "./gota-check"
import conductedFixture from "../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../test/fixtures/responses/gota-check-partial-beats.json"

describe("GotaCheckSchema", () => {
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
