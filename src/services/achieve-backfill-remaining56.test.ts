import { describe, expect, it } from "vitest"
import type { ModuleResult } from "../modules/types"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillRemaining56RequestSchema } from "../schemas/achieve-backfill-remaining56"
import {
  authorizeAchieveBackfillRemaining56,
  initializeAchieveBackfillRemaining56,
  processAchieveBackfillRemaining56Item,
  type AchieveBackfillRemaining56Dependencies,
} from "./achieve-backfill-remaining56"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const callIds = Array.from({ length: 57 }, (_, index) => AchieveBackfillCallIdSchema.parse(
  `approved-call-${String(index + 1).padStart(2, "0")}`,
))
const canaryCallId = callIds[0]

function command() {
  return AchieveBackfillRemaining56RequestSchema.parse({
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
      call_id: canaryCallId,
      audit_only: true,
      approved_digest: digest,
      batch_id: "psai-245-gate-2-approved-manifest",
      canary_id: "psai-245-gate-2-one-call-canary",
      manifest_version: "psai-245-achieve-backfill-manifest-v1",
      snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
    },
  })
}

const gradedResult: ModuleResult = {
  module_name: "achieve_welcome_call_qa",
  result: { grading: "categorical" },
  has_violation: false,
  violation_type: null,
  processing_time_ms: 4,
}

class RecordingDependencies implements AchieveBackfillRemaining56Dependencies {
  claims = 0
  transcriptLoads = 0
  gradingAttempts = 0
  finalizations: Array<unknown> = []
  failures: Array<string> = []
  events: Array<string> = []
  claimResult: Awaited<ReturnType<AchieveBackfillRemaining56Dependencies["claim"]>> = { _tag: "claimed" }

  async initialize() { return { _tag: "ready" } as const }
  async prepare() {
    this.events.push("prepare")
    this.transcriptLoads += 1
    return { _tag: "ready", transcript: "private transcript" } as const
  }
  async claim() { this.events.push("claim"); this.claims += 1; return this.claimResult }
  grade: AchieveBackfillRemaining56Dependencies["grade"] = async () => {
    this.events.push("grade")
    this.gradingAttempts += 1
    return { _tag: "success", result: gradedResult }
  }
  async finalize(_context: unknown, record: unknown) {
    this.finalizations.push(record)
    return { _tag: "inserted" } as const
  }
  recordFailure: AchieveBackfillRemaining56Dependencies["recordFailure"] = async (
    _context,
    _callId,
    reason,
  ) => {
    this.failures.push(reason)
    return { _tag: "recorded" }
  }
}

describe("PSAI-245 remaining-56 audit capability", () => {
  it("requires the exact approved manifest and completed canary provenance", async () => {
    const approved = await authorizeAchieveBackfillRemaining56(command(), { approvedDigest: digest })
    expect(approved).toEqual({ _tag: "authorized", remainingCallIds: callIds.slice(1) })

    const wrongCanary = command()
    wrongCanary.completed_canary.approved_digest = "f".repeat(64)
    expect(await authorizeAchieveBackfillRemaining56(wrongCanary, { approvedDigest: digest }))
      .toEqual({ _tag: "rejected", reason: "completed_canary_provenance_mismatch" })
  })

  it("initializes exactly the manifest minus the completed canary", async () => {
    const deps = new RecordingDependencies()
    const initialized = await initializeAchieveBackfillRemaining56(
      command(), deps, { approvedDigest: digest },
    )

    expect(initialized).toEqual({ _tag: "ready", remainingCallIds: callIds.slice(1) })
  })

  it("prepares the segment, then claims immediately before grading and inserts one metadata-free audit row", async () => {
    const deps = new RecordingDependencies()
    const result = await processAchieveBackfillRemaining56Item(
      command(), callIds[1], 2, deps,
    )

    expect(result).toEqual({ _tag: "completed", ordinal: 2 })
    expect(deps.claims).toBe(1)
    expect(deps.transcriptLoads).toBe(1)
    expect(deps.gradingAttempts).toBe(1)
    expect(deps.events).toEqual(["prepare", "claim", "grade"])
    expect(deps.finalizations).toEqual([{
      callId: callIds[1],
      moduleResult: {
        ...gradedResult,
        result: {
          grading: "categorical",
          backfill: {
            audit_only: true,
            approved_digest: digest,
            batch_id: "psai-245-gate-3-approved-remaining-56",
            capability_id: "psai-245-gate-3-remaining-56-once",
            completed_canary_call_id: canaryCallId,
            manifest_version: "psai-245-achieve-backfill-manifest-v1",
            snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
          },
        },
      },
      alertSent: false,
    }])
  })

  it("checks readiness but never grades a previously attempted item on replay", async () => {
    const deps = new RecordingDependencies()
    deps.claimResult = { _tag: "already_attempted", status: "attempted" }

    expect(await processAchieveBackfillRemaining56Item(command(), callIds[1], 2, deps))
      .toEqual({ _tag: "stopped", ordinal: 2, reason: "attempted" })
    expect(deps.transcriptLoads).toBe(1)
    expect(deps.gradingAttempts).toBe(0)
    expect(deps.finalizations).toEqual([])
  })

  it("durably categorizes per-item failures after a claim without retrying the LLM", async () => {
    const deps = new RecordingDependencies()
    deps.grade = async () => {
      deps.gradingAttempts += 1
      return { _tag: "failure", reason: "grading_unavailable" } as const
    }

    expect(await processAchieveBackfillRemaining56Item(command(), callIds[1], 2, deps))
      .toEqual({ _tag: "stopped", ordinal: 2, reason: "grading_unavailable" })
    expect(deps.gradingAttempts).toBe(1)
    expect(deps.failures).toEqual(["grading_unavailable"])
  })

  it("returns terminal unknown when failure-state persistence is unavailable", async () => {
    const deps = new RecordingDependencies()
    deps.grade = async () => ({ _tag: "failure", reason: "grading_unavailable" })
    deps.recordFailure = async () => ({ _tag: "failure" })

    expect(await processAchieveBackfillRemaining56Item(command(), callIds[1], 2, deps))
      .toEqual({ _tag: "stopped_unknown", ordinal: 2, reason: "failure_persistence_unknown" })
  })

  it("rejects any item interface attempt for the canary or outside the authorized remaining 56", async () => {
    const deps = new RecordingDependencies()
    await expect(processAchieveBackfillRemaining56Item(command(), canaryCallId, 1, deps))
      .rejects.toThrow("Unauthorized PSAI-245 remaining-56 item")
    await expect(processAchieveBackfillRemaining56Item(
      command(), AchieveBackfillCallIdSchema.parse("outside-manifest"), 58, deps,
    )).rejects.toThrow("Unauthorized PSAI-245 remaining-56 item")
    expect(deps.claims).toBe(0)
  })
})
