import { describe, expect, it } from "vitest"
import type { ModuleResult } from "../modules/types"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillResume27RequestSchema } from "../schemas/achieve-backfill-resume27"
import {
  authorizeAchieveBackfillResume27,
  initializeAchieveBackfillResume27,
  processAchieveBackfillResume27Item,
  type AchieveBackfillResume27Dependencies,
} from "./achieve-backfill-resume27"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const fingerprint = "ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4"
const callIds = Array.from({ length: 57 }, (_, index) => AchieveBackfillCallIdSchema.parse(
  `approved-call-${String(index + 1).padStart(2, "0")}`,
))

function command() {
  return AchieveBackfillResume27RequestSchema.parse({
    manifest: {
      representation_version: "psai-245-achieve-backfill-manifest-v1",
      gate: "gate_1_dry_run",
      module_name: "achieve_welcome_call_qa",
      snapshot: {
        cutoff: "2026-08-11T16:21:44.777859Z",
        funnel_counts: [378, 101, 89, 88, 65, 57],
      },
      candidate_count: 57,
      candidates: callIds.map((call_id) => ({
        call_id,
        reason: "approved_frozen_cohort",
        status: "eligible",
      })),
    },
    digest: {
      algorithm: "SHA-256",
      canonicalization: "eavesly-canonical-json-v1",
      value: digest,
    },
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
}

const result: ModuleResult = {
  module_name: "achieve_welcome_call_qa",
  result: { categorical: true },
  has_violation: false,
  violation_type: null,
  processing_time_ms: 1,
}

class RecordingDependencies implements AchieveBackfillResume27Dependencies {
  readonly prepared: Array<string> = []
  readonly claimed: Array<string> = []
  readonly graded: Array<string> = []
  readonly finalized: Array<string> = []

  initialize: AchieveBackfillResume27Dependencies["initialize"] = async () => ({ _tag: "ready" })
  async prepare(callId: string) {
    this.prepared.push(callId)
    return { _tag: "ready", transcript: "private transcript" } as const
  }
  async claim(_context: unknown, callId: string) {
    this.claimed.push(callId)
    return { _tag: "claimed" } as const
  }
  async grade(callId: string) {
    this.graded.push(callId)
    return { _tag: "success", result } as const
  }
  async finalize(_context: unknown, record: { readonly callId: string }) {
    this.finalized.push(record.callId)
    return { _tag: "inserted" } as const
  }
  async recordFailure() { return { _tag: "recorded" } as const }
}

const approval = { approvedDigest: digest, approvedProgressStateFingerprint: fingerprint }

describe("PSAI-245 forward-only resume-27 capability", () => {
  it("authorizes only exact digest/fingerprint and only ordinals after terminal ordinal 30", async () => {
    await expect(authorizeAchieveBackfillResume27(command(), approval)).resolves.toEqual({
      _tag: "authorized",
      pendingCallIds: callIds.slice(30),
    })

    const drifted = command()
    drifted.progress_state_fingerprint.value = "f".repeat(64)
    await expect(authorizeAchieveBackfillResume27(drifted, approval)).resolves.toEqual({
      _tag: "rejected",
      reason: "progress_state_fingerprint_mismatch",
    })
  })

  it("requires the database-verified production state before exposing pending work", async () => {
    const dependencies = new RecordingDependencies()
    dependencies.initialize = async () => ({ _tag: "rejected", reason: "state_drift" })

    await expect(initializeAchieveBackfillResume27(command(), dependencies, approval)).resolves.toEqual({
      _tag: "rejected",
      reason: "state_drift",
    })
    expect(dependencies.prepared).toEqual([])
  })

  it("processes an approved pending ordinal with the existing audit-only Gate 3 finalizer", async () => {
    const dependencies = new RecordingDependencies()

    await expect(processAchieveBackfillResume27Item(command(), callIds[30], 31, dependencies))
      .resolves.toEqual({ _tag: "completed", ordinal: 31 })
    expect(dependencies.prepared).toEqual([callIds[30]])
    expect(dependencies.claimed).toEqual([callIds[30]])
    expect(dependencies.graded).toEqual([callIds[30]])
    expect(dependencies.finalized).toEqual([callIds[30]])
  })

  it("never prepares, claims, or grades terminal ordinal 30 or any completed/outside ordinal", async () => {
    const dependencies = new RecordingDependencies()

    await expect(processAchieveBackfillResume27Item(command(), callIds[29], 30, dependencies))
      .rejects.toThrow("Unauthorized PSAI-245 resume-27 item")
    await expect(processAchieveBackfillResume27Item(command(), callIds[28], 29, dependencies))
      .rejects.toThrow("Unauthorized PSAI-245 resume-27 item")
    await expect(processAchieveBackfillResume27Item(
      command(), AchieveBackfillCallIdSchema.parse("outside-manifest"), 58, dependencies,
    )).rejects.toThrow("Unauthorized PSAI-245 resume-27 item")
    expect(dependencies.prepared).toEqual([])
    expect(dependencies.claimed).toEqual([])
    expect(dependencies.graded).toEqual([])
  })
})
