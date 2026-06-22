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

  // Objective gate: the human tagged a conversation-implying disposition, but the
  // model found no conversation happened — a high-precision mis-disposition.
  const objectiveMismatch = {
    suggested_disposition: "Pre-recorded Voicemail",
    disposition_matches_transcript: false,
    confidence: 0.95,
    conversation_happened: "no",
    evidence: [{ speaker: "system", quote: "[voicemail tone]", rationale: "No live contact." }],
    reasoning_summary: "Call went to voicemail; the Converted/Won disposition implies a completed conversation.",
    alternative_candidates: [],
  }
  const catalog = [{
    name: "1.4 - Converted/Won > END CAMPAIGNS",
    description: "Deal won.",
    visibility: "All Users",
    conversation_happened: "yes",
    ai_only: false,
  }]

  it("flags an objective conversation mismatch for human review", async () => {
    const base = createEvaluateRequest()
    const request = createEvaluateRequest({
      transcript: {
        ...base.transcript,
        metadata: { ...base.transcript.metadata, disposition: "1.4 - Converted/Won > END CAMPAIGNS" },
      },
    })
    const llm = createMockLLM(objectiveMismatch)

    const result = await dispositionReviewModule.evaluate(
      request.transcript.transcript,
      request,
      llm as any,
      null,
      catalog,
    )

    expect(result.has_violation).toBe(true)
    expect(result.violation_type).toBe(VIOLATION_TYPES.MIS_DISPOSITION)
    expect((result.result as any).recommended_action).toBe("surface_for_review")
    expect((result.result as any).permission.requires_human_review).toBe(true)
    expect((result.result as any).permission.can_auto_update).toBe(false)
  })

  it("does NOT flag a subjective relabel where the conversation status agrees", async () => {
    const base = createEvaluateRequest()
    const request = createEvaluateRequest({
      transcript: {
        ...base.transcript,
        metadata: { ...base.transcript.metadata, disposition: "1.2 - Interested > No Call Scheduled" },
      },
    })
    // mismatchFixture: real conversation, model would relabel — the noisy bucket.
    const llm = createMockLLM(mismatchFixture)

    const result = await dispositionReviewModule.evaluate(
      request.transcript.transcript,
      request,
      llm as any,
      null,
      [{ name: "1.2 - Interested > No Call Scheduled", description: null, visibility: "All Users", conversation_happened: "yes", ai_only: false }],
    )

    expect(result.has_violation).toBe(false)
    expect((result.result as any).recommended_action).toBe("no_change")
  })

  it("accepts a live disposition catalog and still evaluates", async () => {
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
      null,
      [
        {
          name: "1.2 - Interested > No Call Scheduled",
          description: "Lead interested, no future call scheduled.",
          visibility: "All Users",
          conversation_happened: "yes",
          ai_only: false,
        },
      ],
    )

    expect(result.module_name).toBe(MODULE_NAMES.DISPOSITION_REVIEW)
    expect(llm.getStructuredResponse).toHaveBeenCalledTimes(1)
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
