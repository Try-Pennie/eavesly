import { describe, it, expect } from "vitest"
import {
  DispositionAnalysisSchema,
  DispositionPermissionSchema,
  DispositionReviewSchema,
} from "./disposition-review"
import matchFixture from "../../test/fixtures/responses/disposition-review-match.json"
import mismatchFixture from "../../test/fixtures/responses/disposition-review-mismatch.json"

describe("DispositionAnalysisSchema", () => {
  it("validates no-change fixture", () => {
    expect(DispositionAnalysisSchema.safeParse(matchFixture).success).toBe(true)
  })

  it("validates mismatch fixture", () => {
    expect(DispositionAnalysisSchema.safeParse(mismatchFixture).success).toBe(true)
  })

  it("requires confidence between 0 and 1", () => {
    expect(DispositionAnalysisSchema.safeParse({ ...mismatchFixture, confidence: 1.2 }).success).toBe(false)
    expect(DispositionAnalysisSchema.safeParse({ ...mismatchFixture, confidence: -0.1 }).success).toBe(false)
  })

  it("restricts conversation_happened to expected values", () => {
    expect(DispositionAnalysisSchema.safeParse({ ...mismatchFixture, conversation_happened: "maybe" }).success).toBe(false)
  })
})

describe("DispositionPermissionSchema", () => {
  it("pins can_auto_update to false", () => {
    expect(DispositionPermissionSchema.safeParse({
      category: "ai_eligible",
      can_auto_update: false,
      requires_human_review: true,
      reason: "Advisory only",
    }).success).toBe(true)

    expect(DispositionPermissionSchema.safeParse({
      category: "ai_eligible",
      can_auto_update: true,
      requires_human_review: false,
      reason: "Should not be allowed",
    }).success).toBe(false)
  })
})

describe("DispositionReviewSchema", () => {
  it("validates the full stored advisory contract", () => {
    const parsed = DispositionReviewSchema.safeParse({
      current_disposition: "Interested",
      ...mismatchFixture,
      permission: {
        category: "ai_eligible",
        can_auto_update: false,
        requires_human_review: true,
        reason: "Suggested disposition is AI-eligible, but this advisory slice never auto-updates — surfaced for human review.",
      },
      recommended_action: "eligible_for_future_auto_update",
    })
    expect(parsed.success).toBe(true)
  })
})
