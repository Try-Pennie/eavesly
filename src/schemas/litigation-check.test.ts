import { describe, it, expect } from "vitest"
import { LitigationCheckSchema } from "./litigation-check"
import noViolationFixture from "../../test/fixtures/responses/litigation-check-no-violation.json"
import violationFixture from "../../test/fixtures/responses/litigation-check-violation.json"
import notApplicableFixture from "../../test/fixtures/responses/litigation-check-not-applicable.json"
import gotaDisclosureFixture from "../../test/fixtures/responses/litigation-check-gota-disclosure.json"

describe("LitigationCheckSchema", () => {
  it("validates no-violation fixture", () => {
    const result = LitigationCheckSchema.safeParse(noViolationFixture)
    expect(result.success).toBe(true)
  })

  it("validates violation fixture", () => {
    const result = LitigationCheckSchema.safeParse(violationFixture)
    expect(result.success).toBe(true)
  })

  it("validates not-applicable fixture", () => {
    const result = LitigationCheckSchema.safeParse(notApplicableFixture)
    expect(result.success).toBe(true)
  })

  it("no-violation fixture has violation false", () => {
    const result = LitigationCheckSchema.parse(noViolationFixture)
    expect(result.violation).toBe(false)
  })

  it("violation fixture has violation true", () => {
    const result = LitigationCheckSchema.parse(violationFixture)
    expect(result.violation).toBe(true)
  })

  it("not-applicable fixture has litigation_discussed false", () => {
    const result = LitigationCheckSchema.parse(notApplicableFixture)
    expect(result.litigation_discussed).toBe(false)
    expect(result.violation).toBe(false)
  })

  it("requires litigation_discussed field", () => {
    const { litigation_discussed, ...rest } = noViolationFixture
    expect(LitigationCheckSchema.safeParse(rest).success).toBe(false)
  })

  it("requires mentions array", () => {
    const { mentions, ...rest } = noViolationFixture
    expect(LitigationCheckSchema.safeParse(rest).success).toBe(false)
  })

  it("requires violation field", () => {
    const { violation, ...rest } = noViolationFixture
    expect(LitigationCheckSchema.safeParse(rest).success).toBe(false)
  })

  it("validates GOTA disclosure fixture", () => {
    const result = LitigationCheckSchema.safeParse(gotaDisclosureFixture)
    expect(result.success).toBe(true)
  })

  it("GOTA disclosure fixture has litigation_discussed false and no violation", () => {
    const result = LitigationCheckSchema.parse(gotaDisclosureFixture)
    expect(result.litigation_discussed).toBe(false)
    expect(result.violation).toBe(false)
  })
})
