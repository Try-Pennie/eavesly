import { describe, it, expect } from "vitest"
import { dispositionReviewModule } from "./module"
import { createMockLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import matchFixture from "../../../test/fixtures/responses/disposition-review-match.json"
import mismatchFixture from "../../../test/fixtures/responses/disposition-review-mismatch.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("dispositionReviewModule", () => {
  it("has correct module name", () => {
    expect(dispositionReviewModule.name).toBe(MODULE_NAMES.DISPOSITION_REVIEW)
  })

  it("returns no violation when current disposition matches transcript", async () => {
    const base = createEvaluateRequest()
    const request = createEvaluateRequest({
      transcript: {
        ...base.transcript,
        metadata: { ...base.transcript.metadata, disposition: "Interested" },
      },
    })
    const llm = createMockLLM(matchFixture)

    const result = await dispositionReviewModule.evaluate(
      request.transcript.transcript,
      request,
      llm as any,
    )

    expect(result.module_name).toBe(MODULE_NAMES.DISPOSITION_REVIEW)
    expect(result.has_violation).toBe(false)
    expect(result.violation_type).toBeNull()
    expect((result.result as any).current_disposition).toBe("Interested")
    expect((result.result as any).permission.can_auto_update).toBe(false)
    expect((result.result as any).recommended_action).toBe("no_change")
  })

  it("flags high-confidence AI-eligible mismatch for human review only", async () => {
    const base = createEvaluateRequest()
    const request = createEvaluateRequest({
      transcript: {
        ...base.transcript,
        metadata: { ...base.transcript.metadata, disposition: "Interested" },
      },
    })
    const llm = createMockLLM(mismatchFixture)

    const result = await dispositionReviewModule.evaluate(
      request.transcript.transcript,
      request,
      llm as any,
    )

    expect(result.has_violation).toBe(true)
    expect(result.violation_type).toBe(VIOLATION_TYPES.MIS_DISPOSITION)
    expect((result.result as any).current_disposition).toBe("Interested")
    expect((result.result as any).suggested_disposition).toBe("Not Interested")
    expect((result.result as any).permission.category).toBe("ai_eligible")
    expect((result.result as any).permission.can_auto_update).toBe(false)
    expect((result.result as any).permission.requires_human_review).toBe(true)
    expect((result.result as any).recommended_action).toBe("eligible_for_future_auto_update")
  })

  it("passes the disposition-review schema name to the LLM", async () => {
    const base = createEvaluateRequest()
    const request = createEvaluateRequest({
      transcript: {
        ...base.transcript,
        metadata: { ...base.transcript.metadata, disposition: "Interested" },
      },
    })
    const llm = createMockLLM(matchFixture)

    await dispositionReviewModule.evaluate(
      request.transcript.transcript,
      request,
      llm as any,
    )

    const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
    expect(schemaName).toBe("disposition_review_evaluation")
  })
})
