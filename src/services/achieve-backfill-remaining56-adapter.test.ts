import { describe, expect, it } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import {
  createSupabaseAchieveBackfillRemaining56Dependencies,
  type AchieveBackfillRemaining56DataAccess,
} from "./achieve-backfill-remaining56-adapter"

const callId = AchieveBackfillCallIdSchema.parse("approved-call-02")
const context = {
  callIds: [callId],
  completedCanaryCallId: AchieveBackfillCallIdSchema.parse("approved-call-01"),
  approvedDigest: "a".repeat(64),
  manifestVersion: "psai-245-achieve-backfill-manifest-v1",
  snapshotCutoff: "2026-08-11T16:21:44.777859Z",
}
const record = {
  callId,
  moduleResult: {
    module_name: "achieve_welcome_call_qa",
    result: { categorical: true },
    has_violation: false,
    violation_type: null,
    processing_time_ms: 1,
  },
  alertSent: false as const,
}

function dataAccess(transcript: string): AchieveBackfillRemaining56DataAccess {
  return {
    initialize: async () => ({ data: [{ status: "ready" }], error: null }),
    claim: async () => ({ data: [{ status: "claimed" }], error: null }),
    loadTranscript: async () => ({
      data: [{ call_id: callId, original_transcript: transcript }],
      error: null,
    }),
    finalize: async () => ({ data: [{ status: "inserted" }], error: null }),
    recordFailure: async () => ({ data: [{ status: "recorded" }], error: null }),
  }
}

describe("PSAI-245 remaining-56 preparation boundary", () => {
  it("privately verifies a bounded gradeable segment before returning readiness", async () => {
    const transcript = [
      "[handling agent]: private pre-handoff",
      "[transfer agent]: Hi, this is Avery with Freedom Debt Relief on a recorded line.",
      "[contact]: hello",
      "[transfer agent]: Welcome to your program.",
    ].join("\n")
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(
      createEnv(),
      dataAccess(transcript),
      async () => { throw new Error("grading is not part of preparation") },
    )

    await expect(dependencies.prepare(callId)).resolves.toEqual({
      _tag: "ready",
      transcript,
    })
  })

  it("maps initialize replay/rejection statuses and malformed responses categorically", async () => {
    let response: unknown = [{ status: "ready" }]
    const access = dataAccess("unused")
    access.initialize = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(createEnv(), access)

    await expect(dependencies.initialize(context)).resolves.toEqual({ _tag: "ready" })
    for (const reason of ["completed_canary_missing", "cohort_conflict", "different_progress"] as const) {
      response = [{ status: reason }]
      await expect(dependencies.initialize(context)).resolves.toEqual({ _tag: "rejected", reason })
    }
    response = [{ status: "unexpected" }]
    await expect(dependencies.initialize(context)).resolves.toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("maps claim replay/rejection statuses and malformed responses categorically", async () => {
    let response: unknown = [{ status: "claimed" }]
    const access = dataAccess("unused")
    access.claim = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(createEnv(), access)

    await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "claimed" })
    for (const status of ["attempted", "completed", "failed"] as const) {
      response = [{ status }]
      await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "already_attempted", status })
    }
    response = [{ status: "rejected" }]
    await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "rejected" })
    response = []
    await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("maps finalize replay/rejection statuses and malformed responses categorically", async () => {
    let response: unknown = [{ status: "inserted" }]
    const access = dataAccess("unused")
    access.finalize = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(createEnv(), access)

    await expect(dependencies.finalize(context, record)).resolves.toEqual({ _tag: "inserted" })
    response = [{ status: "already_completed" }]
    await expect(dependencies.finalize(context, record)).resolves.toEqual({ _tag: "already_completed" })
    response = [{ status: "rejected" }]
    await expect(dependencies.finalize(context, record)).resolves.toEqual({ _tag: "rejected" })
    response = [{ status: "unexpected" }]
    await expect(dependencies.finalize(context, record)).resolves.toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("maps failure persistence replay/rejection and malformed responses categorically", async () => {
    let response: unknown = [{ status: "recorded" }]
    const access = dataAccess("unused")
    access.recordFailure = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(createEnv(), access)

    await expect(dependencies.recordFailure(context, callId, "grading_unavailable"))
      .resolves.toEqual({ _tag: "recorded" })
    response = [{ status: "already_recorded" }]
    await expect(dependencies.recordFailure(context, callId, "grading_unavailable"))
      .resolves.toEqual({ _tag: "already_recorded" })
    for (const malformed of [[{ status: "rejected" }], [{ status: "unexpected" }], []]) {
      response = malformed
      await expect(dependencies.recordFailure(context, callId, "grading_unavailable"))
        .resolves.toEqual({ _tag: "failure" })
    }
  })

  it("stops before claim/LLM when no bounded segment is gradeable", async () => {
    const dependencies = createSupabaseAchieveBackfillRemaining56Dependencies(
      createEnv(),
      dataAccess("[handling agent]: no transfer leg"),
      async () => { throw new Error("must not grade") },
    )

    await expect(dependencies.prepare(callId)).resolves.toEqual({
      _tag: "failure",
      reason: "segment_unavailable",
    })
  })
})
