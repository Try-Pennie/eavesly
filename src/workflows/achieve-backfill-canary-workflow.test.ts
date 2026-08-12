import { describe, expect, it } from "vitest"
import { AchieveBackfillCanaryRequestSchema } from "../schemas/achieve-backfill-canary"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import type { AchieveBackfillCanaryDependencies } from "../services/achieve-backfill-canary"
import {
  ACHIEVE_BACKFILL_CANARY_RETRY_LIMIT,
  achieveBackfillCanaryWorkflowInstanceId,
  executeAchieveBackfillCanaryWorkflow,
  type AchieveBackfillCanaryWorkflowSteps,
} from "./achieve-backfill-canary-workflow"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const callIds = Array.from({ length: 57 }, (_, index) =>
  AchieveBackfillCallIdSchema.parse(
    `approved-call-${String(index + 1).padStart(2, "0")}`,
  ))
const payload = AchieveBackfillCanaryRequestSchema.parse({
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
  canary_call_id: callIds[0],
})

class ReplayingSteps implements AchieveBackfillCanaryWorkflowSteps {
  executions = 0
  private completed: Awaited<ReturnType<AchieveBackfillCanaryWorkflowSteps["execute"]>> | undefined

  async execute(
    callback: () => ReturnType<AchieveBackfillCanaryWorkflowSteps["execute"]>,
  ) {
    if (this.completed !== undefined) return this.completed
    this.executions += 1
    this.completed = await callback()
    return this.completed
  }
}

function dependencies(): AchieveBackfillCanaryDependencies & { gradingAttempts: number } {
  const result: AchieveBackfillCanaryDependencies & { gradingAttempts: number } = {
    gradingAttempts: 0,
    inspect: async () => ({
      _tag: "success",
      knownCallIds: callIds,
      existingResults: [],
    }),
    loadTranscript: async () => ({ _tag: "success", transcript: "private transcript" }),
    grade: async () => {
      result.gradingAttempts += 1
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
  }
  return result
}

describe("dedicated Achieve backfill canary Workflow", () => {
  it("forbids automatic LLM retries", () => {
    expect(ACHIEVE_BACKFILL_CANARY_RETRY_LIMIT).toBe(0)
  })

  it("derives one instance identity from digest and canary identity, not selected member", () => {
    expect(achieveBackfillCanaryWorkflowInstanceId(digest)).toBe(
      `psai-245-gate-2-one-call-canary-${digest}`,
    )
  })

  it("parses the serialized payload again before using dependencies", async () => {
    const deps = dependencies()
    const steps = new ReplayingSteps()

    await expect(executeAchieveBackfillCanaryWorkflow(
      { ...payload, transcript: "forbidden" },
      steps,
      deps,
      { approvedDigest: digest },
    )).rejects.toThrow("Invalid PSAI-245 canary workflow payload")
    expect(deps.gradingAttempts).toBe(0)
  })

  it("durably owns grading so a Workflow replay cannot invoke the LLM twice", async () => {
    const deps = dependencies()
    const steps = new ReplayingSteps()

    const first = await executeAchieveBackfillCanaryWorkflow(
      payload,
      steps,
      deps,
      { approvedDigest: digest },
    )
    const replay = await executeAchieveBackfillCanaryWorkflow(
      payload,
      steps,
      deps,
      { approvedDigest: digest },
    )

    expect(first).toEqual({
      status: "completed",
      candidate_count: 57,
      approved_digest: digest,
    })
    expect(replay).toEqual(first)
    expect(deps.gradingAttempts).toBe(1)
    expect(steps.executions).toBe(1)
  })
})
