import { describe, expect, it } from "vitest"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillRemaining56RequestSchema } from "../schemas/achieve-backfill-remaining56"
import type { AchieveBackfillRemaining56Dependencies } from "../services/achieve-backfill-remaining56"
import {
  ACHIEVE_BACKFILL_REMAINING56_RETRY_LIMIT,
  achieveBackfillRemaining56WorkflowInstanceId,
  executeAchieveBackfillRemaining56Workflow,
  type AchieveBackfillRemaining56WorkflowSteps,
} from "./achieve-backfill-remaining56-workflow"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const callIds = Array.from({ length: 57 }, (_, index) => AchieveBackfillCallIdSchema.parse(
  `approved-call-${String(index + 1).padStart(2, "0")}`,
))
const payload = AchieveBackfillRemaining56RequestSchema.parse({
  manifest: {
    representation_version: "psai-245-achieve-backfill-manifest-v1",
    gate: "gate_1_dry_run",
    module_name: "achieve_welcome_call_qa",
    snapshot: { cutoff: "2026-08-11T16:21:44.777859Z", funnel_counts: [378, 101, 89, 88, 65, 57] },
    candidate_count: 57,
    candidates: callIds.map((call_id) => ({ call_id, reason: "approved_frozen_cohort", status: "eligible" })),
  },
  digest: { algorithm: "SHA-256", canonicalization: "eavesly-canonical-json-v1", value: digest },
  completed_canary: {
    call_id: callIds[0],
    audit_only: true,
    approved_digest: digest,
    batch_id: "psai-245-gate-2-approved-manifest",
    canary_id: "psai-245-gate-2-one-call-canary",
    manifest_version: "psai-245-achieve-backfill-manifest-v1",
    snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
  },
})

class DurableSteps implements AchieveBackfillRemaining56WorkflowSteps {
  private initialization: Awaited<ReturnType<AchieveBackfillRemaining56WorkflowSteps["initialize"]>> | undefined
  private readonly items = new Map<number, Awaited<ReturnType<AchieveBackfillRemaining56WorkflowSteps["process"]>>>()

  async initialize(callback: Parameters<AchieveBackfillRemaining56WorkflowSteps["initialize"]>[0]) {
    this.initialization ??= await callback()
    return this.initialization
  }
  async process(ordinal: number, callback: Parameters<AchieveBackfillRemaining56WorkflowSteps["process"]>[1]) {
    const existing = this.items.get(ordinal)
    if (existing !== undefined) return existing
    const result = await callback()
    this.items.set(ordinal, result)
    return result
  }
}

function dependencies() {
  const attempted = new Set<string>()
  const gradingAttempts = new Map<string, number>()
  const deps: AchieveBackfillRemaining56Dependencies = {
    initialize: async () => ({ _tag: "ready" }),
    claim: async (_context, callId) => {
      if (attempted.has(callId)) return { _tag: "already_attempted", status: "attempted" }
      attempted.add(callId)
      return { _tag: "claimed" }
    },
    prepare: async () => ({ _tag: "ready", transcript: "private" }),
    grade: async (callId) => {
      gradingAttempts.set(callId, (gradingAttempts.get(callId) ?? 0) + 1)
      return {
        _tag: "success",
        result: {
          module_name: "achieve_welcome_call_qa",
          result: { categorical: true },
          has_violation: false,
          violation_type: null,
          processing_time_ms: 1,
        },
      }
    },
    finalize: async () => ({ _tag: "inserted" }),
    recordFailure: async () => ({ _tag: "recorded" }),
  }
  return { deps, attempted, gradingAttempts }
}

describe("dedicated PSAI-245 remaining-56 Workflow", () => {
  it("matches the production-proven Gate 2 no-retry limit", () => {
    expect(ACHIEVE_BACKFILL_REMAINING56_RETRY_LIMIT).toBe(0)
  })

  it("derives a separate deterministic instance identity", () => {
    expect(achieveBackfillRemaining56WorkflowInstanceId(digest)).toBe(
      `psai-245-gate-3-remaining-56-once-${digest}`,
    )
  })

  it("processes all and only the 56 non-canary manifest members with categorical output", async () => {
    const state = dependencies()
    const result = await executeAchieveBackfillRemaining56Workflow(
      payload, new DurableSteps(), state.deps, { approvedDigest: digest },
    )

    expect(result).toEqual({
      status: "completed",
      candidate_count: 57,
      remaining_count: 56,
      completed: 56,
      skipped: 0,
      failed: 0,
      approved_digest: digest,
    })
    expect(state.attempted.size).toBe(56)
    expect(state.attempted.has(callIds[0])).toBe(false)
    expect([...state.gradingAttempts.values()].every((attempts) => attempts === 1)).toBe(true)
  })

  it("stops on the first anomaly and never reports the run completed", async () => {
    const state = dependencies()
    const originalGrade = state.deps.grade
    state.deps.grade = async (callId, transcript) => {
      if (callId === callIds[2]) return { _tag: "failure", reason: "grading_unavailable" }
      return originalGrade(callId, transcript)
    }

    const result = await executeAchieveBackfillRemaining56Workflow(
      payload, new DurableSteps(), state.deps, { approvedDigest: digest },
    )

    expect(result).toEqual({
      status: "stopped",
      reason: "grading_unavailable",
      candidate_count: 57,
      remaining_count: 56,
      completed: 1,
      skipped: 0,
      failed: 1,
      approved_digest: digest,
    })
    expect(state.attempted.size).toBe(2)
    expect(state.attempted.has(callIds[3])).toBe(false)
  })

  it("stops with unknown outcome when failure persistence is unavailable", async () => {
    const state = dependencies()
    state.deps.grade = async () => ({ _tag: "failure", reason: "grading_unavailable" })
    state.deps.recordFailure = async () => ({ _tag: "failure" })

    const result = await executeAchieveBackfillRemaining56Workflow(
      payload, new DurableSteps(), state.deps, { approvedDigest: digest },
    )

    expect(result).toMatchObject({
      status: "stopped",
      reason: "failure_persistence_unknown",
      completed: 0,
      failed: 0,
    })
    expect(state.attempted.size).toBe(1)
  })

  it("a callback replay after a durable claim cannot make a second LLM attempt", async () => {
    const state = dependencies()
    const callId = callIds[1]
    const context = {
      callIds,
      completedCanaryCallId: callIds[0],
      approvedDigest: digest,
      manifestVersion: "psai-245-achieve-backfill-manifest-v1",
      snapshotCutoff: "2026-08-11T16:21:44.777859Z",
    }

    expect(await state.deps.claim(context, callId)).toEqual({ _tag: "claimed" })
    expect(await state.deps.grade(callId, "private")).toMatchObject({ _tag: "success" })
    expect(await state.deps.claim(context, callId)).toEqual({
      _tag: "already_attempted",
      status: "attempted",
    })
    expect(state.gradingAttempts.get(callId)).toBe(1)
  })
})
