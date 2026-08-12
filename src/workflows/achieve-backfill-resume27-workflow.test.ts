import { describe, expect, it } from "vitest"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillResume27RequestSchema } from "../schemas/achieve-backfill-resume27"
import type { AchieveBackfillResume27Dependencies } from "../services/achieve-backfill-resume27"
import {
  ACHIEVE_BACKFILL_RESUME27_RETRY_LIMIT,
  achieveBackfillResume27WorkflowInstanceId,
  executeAchieveBackfillResume27Workflow,
  type AchieveBackfillResume27WorkflowSteps,
} from "./achieve-backfill-resume27-workflow"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const fingerprint = "ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4"
const callIds = Array.from({ length: 57 }, (_, index) => AchieveBackfillCallIdSchema.parse(
  `approved-call-${String(index + 1).padStart(2, "0")}`,
))
const payload = AchieveBackfillResume27RequestSchema.parse({
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
  progress_state_fingerprint: {
    algorithm: "SHA-256",
    canonicalization: "psai-245-resume-progress-state-v1",
    value: fingerprint,
  },
})
const approval = { approvedDigest: digest, approvedProgressStateFingerprint: fingerprint }

class ImmediateSteps implements AchieveBackfillResume27WorkflowSteps {
  readonly ordinals: Array<number> = []
  async initialize(callback: Parameters<AchieveBackfillResume27WorkflowSteps["initialize"]>[0]) {
    return callback()
  }
  async process(ordinal: number, callback: Parameters<AchieveBackfillResume27WorkflowSteps["process"]>[1]) {
    this.ordinals.push(ordinal)
    return callback()
  }
}

function dependencies() {
  const prepared: Array<string> = []
  const claimed: Array<string> = []
  const graded: Array<string> = []
  const deps: AchieveBackfillResume27Dependencies = {
    initialize: async () => ({ _tag: "ready" }),
    prepare: async (callId) => { prepared.push(callId); return { _tag: "ready", transcript: "private" } },
    claim: async (_context, callId) => { claimed.push(callId); return { _tag: "claimed" } },
    grade: async (callId) => {
      graded.push(callId)
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
  return { deps, prepared, claimed, graded }
}

describe("dedicated PSAI-245 resume-27 Workflow", () => {
  it("uses a deterministic identity distinct from Gate 3 and preserves no retries", () => {
    expect(ACHIEVE_BACKFILL_RESUME27_RETRY_LIMIT).toBe(0)
    const instanceId = achieveBackfillResume27WorkflowInstanceId(digest, fingerprint)
    expect(instanceId).toBe("psai245-r27-298d6e8202117910-ce2f6acc1fe56eea")
    expect(instanceId.length).toBeLessThanOrEqual(64)
  })

  it("processes exactly ordinals 31 through 57 sequentially and never touches ordinal 30", async () => {
    const state = dependencies()
    const steps = new ImmediateSteps()

    await expect(executeAchieveBackfillResume27Workflow(payload, steps, state.deps, approval))
      .resolves.toEqual({
        status: "completed",
        candidate_count: 57,
        resume_count: 27,
        completed: 27,
        failed: 0,
        approved_digest: digest,
        progress_state_fingerprint: fingerprint,
      })
    expect(steps.ordinals).toEqual(Array.from({ length: 27 }, (_, index) => index + 31))
    expect(state.prepared).toEqual(callIds.slice(30))
    expect(state.claimed).toEqual(callIds.slice(30))
    expect(state.graded).toEqual(callIds.slice(30))
    expect(state.prepared).not.toContain(callIds[29])
  })

  it("stops on the first new anomaly without preparing a later ordinal", async () => {
    const state = dependencies()
    state.deps.prepare = async (callId) => {
      state.prepared.push(callId)
      if (callId === callIds[32]) return { _tag: "failure", reason: "segment_unavailable" }
      return { _tag: "ready", transcript: "private" }
    }
    const steps = new ImmediateSteps()

    await expect(executeAchieveBackfillResume27Workflow(payload, steps, state.deps, approval))
      .resolves.toMatchObject({
        status: "stopped",
        reason: "segment_unavailable",
        completed: 2,
        failed: 1,
      })
    expect(steps.ordinals).toEqual([31, 32, 33])
    expect(state.prepared).toEqual(callIds.slice(30, 33))
    expect(state.prepared).not.toContain(callIds[33])
  })

  it("stops before all item work when the persisted production fixture drifted", async () => {
    const state = dependencies()
    state.deps.initialize = async () => ({ _tag: "rejected", reason: "state_drift" })

    await expect(executeAchieveBackfillResume27Workflow(payload, new ImmediateSteps(), state.deps, approval))
      .resolves.toMatchObject({ status: "stopped", reason: "state_drift", completed: 0, failed: 0 })
    expect(state.prepared).toEqual([])
    expect(state.claimed).toEqual([])
    expect(state.graded).toEqual([])
  })
})
