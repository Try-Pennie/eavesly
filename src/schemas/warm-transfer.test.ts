import { describe, it, expect } from "vitest"
import { WarmTransferSchema } from "./warm-transfer"
import noViolationFixture from "../../test/fixtures/responses/warm-transfer-no-violation.json"
import violationFixture from "../../test/fixtures/responses/warm-transfer-violation.json"

describe("WarmTransferSchema", () => {
  it("validates no-violation fixture", () => {
    const result = WarmTransferSchema.safeParse(noViolationFixture)
    expect(result.success).toBe(true)
  })

  it("validates violation fixture", () => {
    const result = WarmTransferSchema.safeParse(violationFixture)
    expect(result.success).toBe(true)
  })

  it("no-violation fixture has warm_transfer_violation false", () => {
    const result = WarmTransferSchema.parse(noViolationFixture)
    expect(result.warm_transfer_compliance.warm_transfer_violation).toBe(false)
  })

  it("violation fixture has warm_transfer_violation true", () => {
    const result = WarmTransferSchema.parse(violationFixture)
    expect(result.warm_transfer_compliance.warm_transfer_violation).toBe(true)
  })

  it("requires warm_transfer_compliance section", () => {
    const { warm_transfer_compliance, ...rest } = noViolationFixture
    expect(WarmTransferSchema.safeParse(rest).success).toBe(false)
  })

  it("requires enrollment_completed in call_overview", () => {
    const modified = {
      ...noViolationFixture,
      call_overview: (() => {
        const { enrollment_completed, ...rest } = noViolationFixture.call_overview
        return rest
      })(),
    }
    expect(WarmTransferSchema.safeParse(modified).success).toBe(false)
  })

  it("shares FullQA structure for compliance_scorecard", () => {
    const { compliance_scorecard, ...rest } = noViolationFixture
    expect(WarmTransferSchema.safeParse(rest).success).toBe(false)
  })

  it("shares FullQA structure for customer_experience_scorecard", () => {
    const { customer_experience_scorecard, ...rest } = noViolationFixture
    expect(WarmTransferSchema.safeParse(rest).success).toBe(false)
  })

  it("shares FullQA structure for sales_process_scorecard", () => {
    const { sales_process_scorecard, ...rest } = noViolationFixture
    expect(WarmTransferSchema.safeParse(rest).success).toBe(false)
  })

  it("requires all warm_transfer_compliance fields", () => {
    const modified = {
      ...noViolationFixture,
      warm_transfer_compliance: {
        enrollment_completed: false,
        // Missing other required fields
      },
    }
    expect(WarmTransferSchema.safeParse(modified).success).toBe(false)
  })

  it("rejects invalid overall_score in call rating", () => {
    const modified = {
      ...noViolationFixture,
      overall_call_rating: {
        ...noViolationFixture.overall_call_rating,
        overall_score: "terrible",
      },
    }
    expect(WarmTransferSchema.safeParse(modified).success).toBe(false)
  })
})
