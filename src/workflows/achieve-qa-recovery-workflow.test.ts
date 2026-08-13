import { describe, expect, it } from "vitest"
import { MODULE_NAMES } from "../modules/constants"
import type { ModuleResult } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import type { AchieveQaRecoveryExecutionDependencies } from "../services/achieve-qa-recovery"
import { inspectAchieveQaRecovery } from "../services/achieve-qa-recovery"
import { DEFAULT_RESOLVER_POLICY } from "../services/regal-events"
import {
  ACHIEVE_QA_RECOVERY_RETRY_LIMIT,
  executeAchieveQaRecoveryWorkflow,
} from "./achieve-qa-recovery-workflow"

import {
  AchieveQaRecoveryCallIdSchema,
  type AchieveQaRecoveryCallId,
} from "../schemas/achieve-qa-recovery"

const callIds = Array.from(
  { length: 17 },
  (_, index) => AchieveQaRecoveryCallIdSchema.parse(`approved-gap-${String(index + 1).padStart(2, "0")}`),
)
const GRADEABLE_TRANSCRIPT = [
  "[handling agent]: A client success advocate will take your welcome call in a moment.",
  "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
  "[transfer agent]: Hi. This is Julissa with Freedom Debt Relief on a recorded line.",
  "[contact]: Hi.",
  "[transfer agent]: Welcome to your program. Your deposits go into your dedicated account.",
  "[transfer agent]: We negotiate with each creditor and you authorize settlements.",
  "[transfer agent]: Let's set up your client dashboard now.",
  "[transfer agent]: Congratulations again and have a great evening!",
].join("\n")

function input(callId: string, transcript = GRADEABLE_TRANSCRIPT): EvaluateRequest {
  return {
    call_id: callId,
    agent_id: "",
    transcript: {
      transcript,
      metadata: {
        duration: 301,
        timestamp: "2026-08-12T00:00:00Z",
        disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
      },
    },
    sfdc_lead_id: `lead-${callId}`,
  }
}

class RecordingRecoveryDependencies implements AchieveQaRecoveryExecutionDependencies {
  readonly graded: Array<string> = []
  readonly finalized: Array<{ callId: string; result: ModuleResult }> = []
  existingBeforeGrade = false
  transcript = GRADEABLE_TRANSCRIPT

  async inspect(requestedCallIds: ReadonlyArray<AchieveQaRecoveryCallId>) {
    return {
      _tag: "success" as const,
      policy: DEFAULT_RESOLVER_POLICY,
      candidates: requestedCallIds.map((callId, index) =>
        index < 5
          ? { callId, existingResult: false, input: input(callId, this.transcript) }
          : {
              callId,
              existingResult: false,
              input: null,
              inputStatus: "transcript_unavailable" as const,
            },
      ),
    }
  }

  async hasExistingResult() {
    return { _tag: "success" as const, exists: this.existingBeforeGrade }
  }

  async grade(candidate: EvaluateRequest) {
    this.graded.push(candidate.call_id)
    return {
      _tag: "success" as const,
      result: {
        module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
        result: { partner_id: "achieve", grading_skipped: false },
        has_violation: false,
        violation_type: null,
        processing_time_ms: 12,
      },
    }
  }

  async finalize(callId: AchieveQaRecoveryCallId, result: ModuleResult) {
    this.finalized.push({ callId, result })
    return { _tag: "inserted" as const }
  }
}

describe("dedicated Achieve QA Gate 4 recovery Workflow", () => {
  it("rechecks the exact approved digest and performs five no-retry, no-alert ordinary insert operations", async () => {
    const dependencies = new RecordingRecoveryDependencies()
    const snapshot = await inspectAchieveQaRecovery(dependencies, callIds)
    if ("_tag" in snapshot) throw new Error("fixture inspection failed")
    let stepExecutions = 0

    const result = await executeAchieveQaRecoveryWorkflow(
      { call_ids: callIds, digest: snapshot.digest },
      {
        async execute(callback) {
          stepExecutions += 1
          return callback()
        },
      },
      dependencies,
      snapshot.digest.value,
    )

    expect(ACHIEVE_QA_RECOVERY_RETRY_LIMIT).toBe(0)
    expect(stepExecutions).toBe(1)
    expect(result).toEqual({
      status: "completed",
      candidate_count: 17,
      processable_count: 5,
      transcript_available_count: 5,
      transcript_unavailable_count: 12,
      segment_unavailable_count: 0,
      invalid_input_count: 0,
      unknown_call_count: 0,
      ineligible_count: 0,
      existing_result_count: 0,
      completed_count: 5,
    })
    expect(dependencies.graded).toHaveLength(5)
    expect(dependencies.finalized).toHaveLength(5)
    for (const finalized of dependencies.finalized) {
      expect(finalized.result.result).not.toHaveProperty("backfill")
      expect(finalized.result.result).not.toHaveProperty("audit_only")
    }
  })

  it("stops before grading when the immediate result recheck finds a concurrent winner", async () => {
    const dependencies = new RecordingRecoveryDependencies()
    const snapshot = await inspectAchieveQaRecovery(dependencies, callIds)
    if ("_tag" in snapshot) throw new Error("fixture inspection failed")
    dependencies.existingBeforeGrade = true

    const result = await executeAchieveQaRecoveryWorkflow(
      { call_ids: callIds, digest: snapshot.digest },
      { async execute(callback) { return callback() } },
      dependencies,
      snapshot.digest.value,
    )

    expect(result).toMatchObject({
      status: "stopped",
      reason: "existing_result_detected",
      completed_count: 0,
    })
    expect(dependencies.graded).toEqual([])
    expect(dependencies.finalized).toEqual([])
  })

  it("categorizes stored but unbounded transcripts and never grades or inserts a grading-skipped result", async () => {
    const dependencies = new RecordingRecoveryDependencies()
    dependencies.transcript = "Stored transcript without a bounded live welcome-call segment"
    const snapshot = await inspectAchieveQaRecovery(dependencies, callIds)
    if ("_tag" in snapshot) throw new Error("fixture inspection failed")

    const result = await executeAchieveQaRecoveryWorkflow(
      { call_ids: callIds, digest: snapshot.digest },
      { async execute(callback) { return callback() } },
      dependencies,
      snapshot.digest.value,
    )

    expect(result).toMatchObject({
      status: "completed",
      processable_count: 0,
      transcript_available_count: 5,
      transcript_unavailable_count: 12,
      segment_unavailable_count: 5,
      completed_count: 0,
    })
    expect(dependencies.graded).toEqual([])
    expect(dependencies.finalized).toEqual([])
  })
})
