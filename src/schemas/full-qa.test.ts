import { describe, it, expect } from "vitest"
import { FullQASchema } from "./full-qa"
import excellentFixture from "../../test/fixtures/responses/full-qa-excellent.json"
import violationFixture from "../../test/fixtures/responses/full-qa-violation.json"

describe("FullQASchema", () => {
  it("validates excellent call fixture", () => {
    const result = FullQASchema.safeParse(excellentFixture)
    expect(result.success).toBe(true)
  })

  it("validates violation call fixture", () => {
    const result = FullQASchema.safeParse(violationFixture)
    expect(result.success).toBe(true)
  })

  it("excellent fixture has manager_review_required false", () => {
    const result = FullQASchema.parse(excellentFixture)
    expect(result.call_overview.manager_review_required).toBe(false)
  })

  it("violation fixture has manager_review_required true", () => {
    const result = FullQASchema.parse(violationFixture)
    expect(result.call_overview.manager_review_required).toBe(true)
  })

  it("rejects missing call_overview", () => {
    const { call_overview, ...rest } = excellentFixture
    expect(FullQASchema.safeParse(rest).success).toBe(false)
  })

  it("rejects missing compliance_scorecard", () => {
    const { compliance_scorecard, ...rest } = excellentFixture
    expect(FullQASchema.safeParse(rest).success).toBe(false)
  })

  it("rejects missing customer_experience_scorecard", () => {
    const { customer_experience_scorecard, ...rest } = excellentFixture
    expect(FullQASchema.safeParse(rest).success).toBe(false)
  })

  it("rejects missing sales_process_scorecard", () => {
    const { sales_process_scorecard, ...rest } = excellentFixture
    expect(FullQASchema.safeParse(rest).success).toBe(false)
  })

  it("rejects missing overall_call_rating", () => {
    const { overall_call_rating, ...rest } = excellentFixture
    expect(FullQASchema.safeParse(rest).success).toBe(false)
  })

  it("rejects invalid overall_score enum value", () => {
    const modified = {
      ...excellentFixture,
      overall_call_rating: {
        ...excellentFixture.overall_call_rating,
        overall_score: "amazing",
      },
    }
    expect(FullQASchema.safeParse(modified).success).toBe(false)
  })

  it("rejects invalid call_duration_assessment value", () => {
    const modified = {
      ...excellentFixture,
      call_overview: {
        ...excellentFixture.call_overview,
        call_duration_assessment: "very_short",
      },
    }
    expect(FullQASchema.safeParse(modified).success).toBe(false)
  })

  it("accepts valid call_duration_assessment values", () => {
    for (const value of ["efficient", "appropriate", "too_long"]) {
      const modified = {
        ...excellentFixture,
        call_overview: {
          ...excellentFixture.call_overview,
          call_duration_assessment: value,
        },
      }
      expect(FullQASchema.safeParse(modified).success).toBe(true)
    }
  })
})
