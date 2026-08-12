import { describe, expect, it } from "vitest"
import adapterSource from "./achieve-backfill-resume27-adapter.ts?raw"
import { createEnv } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import type { AchieveBackfillRemaining56Dependencies } from "./achieve-backfill-remaining56"
import {
  createSupabaseAchieveBackfillResume27Dependencies,
  type AchieveBackfillResume27DataAccess,
} from "./achieve-backfill-resume27-adapter"

const callId = AchieveBackfillCallIdSchema.parse("approved-call-31")
const context = {
  callIds: [callId],
  completedCanaryCallId: AchieveBackfillCallIdSchema.parse("approved-call-01"),
  approvedDigest: "a".repeat(64),
  manifestVersion: "psai-245-achieve-backfill-manifest-v1",
  snapshotCutoff: "2026-08-11T16:21:44.777859Z",
  progressStateFingerprint: "b".repeat(64),
}

function baseDependencies(): AchieveBackfillRemaining56Dependencies {
  return {
    initialize: async () => ({ _tag: "ready" }),
    prepare: async () => ({ _tag: "ready", transcript: "private" }),
    claim: async () => ({ _tag: "claimed" }),
    grade: async () => ({
      _tag: "success",
      result: {
        module_name: "achieve_welcome_call_qa",
        result: { categorical: true },
        has_violation: false,
        violation_type: null,
        processing_time_ms: 1,
      },
    }),
    finalize: async () => ({ _tag: "inserted" }),
    recordFailure: async () => ({ _tag: "recorded" }),
  }
}

function dataAccess(): AchieveBackfillResume27DataAccess {
  return {
    initialize: async () => ({ data: [{ status: "ready" }], error: null }),
    claim: async () => ({ data: [{ status: "claimed" }], error: null }),
  }
}

describe("PSAI-245 resume-27 persistence adapter", () => {
  it("uses only the certified resume claim RPC", () => {
    expect(adapterSource).toContain("eavesly_claim_achieve_backfill_resume27_v1")
    expect(adapterSource).not.toContain("eavesly_claim_achieve_backfill_remaining56_v1")
  })

  it("maps database state drift and authorization replay categorically", async () => {
    let response: unknown = [{ status: "ready" }]
    const access = dataAccess()
    access.initialize = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillResume27Dependencies(
      createEnv(), access, baseDependencies(),
    )

    await expect(dependencies.initialize(context)).resolves.toEqual({ _tag: "ready" })
    for (const reason of ["state_drift", "different_authorization"] as const) {
      response = [{ status: reason }]
      await expect(dependencies.initialize(context)).resolves.toEqual({ _tag: "rejected", reason })
    }
    response = [{ status: "unexpected" }]
    await expect(dependencies.initialize(context)).resolves.toEqual({
      _tag: "failure",
      reason: "invalid_response",
    })
  })

  it("maps only the forward-only resume claim statuses", async () => {
    let response: unknown = [{ status: "claimed" }]
    const access = dataAccess()
    access.claim = async () => ({ data: response, error: null })
    const dependencies = createSupabaseAchieveBackfillResume27Dependencies(
      createEnv(), access, baseDependencies(),
    )

    await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "claimed" })
    for (const status of ["attempted", "completed", "failed"] as const) {
      response = [{ status }]
      await expect(dependencies.claim(context, callId)).resolves.toEqual({
        _tag: "already_attempted",
        status,
      })
    }
    response = [{ status: "rejected" }]
    await expect(dependencies.claim(context, callId)).resolves.toEqual({ _tag: "rejected" })
  })

  it("preserves the dedicated one-shot grader supplied by the Gate 3 dependency seam", async () => {
    const base = baseDependencies()
    let grades = 0
    base.grade = async () => {
      grades += 1
      return { _tag: "failure", reason: "grading_unavailable" }
    }
    const dependencies = createSupabaseAchieveBackfillResume27Dependencies(createEnv(), dataAccess(), base)

    await expect(dependencies.grade(callId, "private")).resolves.toEqual({
      _tag: "failure",
      reason: "grading_unavailable",
    })
    expect(grades).toBe(1)
  })
})
