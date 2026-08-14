import { describe, expect, it } from "vitest"
import { MODULE_NAMES } from "../modules/constants"
import type { ModuleResult } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import type {
  AchieveQaRecoveryExecutionDependencies,
  AchieveQaRecoverySource,
} from "../services/achieve-qa-recovery"
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

function source(
  callId: string,
  transcript = GRADEABLE_TRANSCRIPT,
  sourceKind: AchieveQaRecoverySource["sourceKind"] = "legacy_qa",
): AchieveQaRecoverySource {
  return {
    sourceKind,
    transcript,
    metadata: {
      duration: 301,
      timestamp: "2026-08-12T00:00:00Z",
      disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
    },
    sfdcLeadId: `lead-${callId}`,
  }
}

class RecordingRecoveryDependencies implements AchieveQaRecoveryExecutionDependencies {
  readonly graded: Array<EvaluateRequest> = []
  readonly finalized: Array<{ callId: string; result: ModuleResult }> = []
  existingBeforeGrade = false
  transcript = GRADEABLE_TRANSCRIPT
  availableCount = 5
  canonicalStartIndex = Number.POSITIVE_INFINITY

  async inspect(requestedCallIds: ReadonlyArray<AchieveQaRecoveryCallId>) {
    return {
      _tag: "success" as const,
      policy: DEFAULT_RESOLVER_POLICY,
      candidates: requestedCallIds.map((callId, index) =>
        index < this.availableCount
          ? {
              callId,
              existingResult: false,
              source: source(
                callId,
                this.transcript,
                index >= this.canonicalStartIndex ? "canonical_event" : "legacy_qa",
              ),
            }
          : {
              callId,
              existingResult: false,
              source: null,
              inputStatus: "transcript_unavailable" as const,
            },
      ),
    }
  }

  async hasExistingResult() {
    return { _tag: "success" as const, exists: this.existingBeforeGrade }
  }

  async grade(candidate: EvaluateRequest) {
    this.graded.push(candidate)
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

  it("classifies the complete five-legacy plus twelve-ledger source set", async () => {
    const dependencies = new RecordingRecoveryDependencies()
    dependencies.availableCount = 17
    dependencies.canonicalStartIndex = 5

    const snapshot = await inspectAchieveQaRecovery(dependencies, callIds)
    if ("_tag" in snapshot) throw new Error("fixture inspection failed")

    expect(snapshot.summary).toMatchObject({
      candidate_count: 17,
      transcript_available_count: 17,
      transcript_unavailable_count: 0,
      processable_count: 17,
    })
    expect(snapshot.manifest.candidates.filter((candidate) => candidate.source_kind === "legacy_qa")).toHaveLength(5)
    expect(snapshot.manifest.candidates.filter((candidate) => candidate.source_kind === "canonical_event")).toHaveLength(12)
  })

  it("hashes oversized canonical sources but sends only deterministic bounded segments to grading", async () => {
    const dependencies = new RecordingRecoveryDependencies()
    dependencies.canonicalStartIndex = 0
    dependencies.transcript = `[handling agent]: ${"x".repeat(205_000)}\n${GRADEABLE_TRANSCRIPT}`
    const snapshot = await inspectAchieveQaRecovery(dependencies, callIds)
    if ("_tag" in snapshot) throw new Error("fixture inspection failed")

    const result = await executeAchieveQaRecoveryWorkflow(
      { call_ids: callIds, digest: snapshot.digest },
      { async execute(callback) { return callback() } },
      dependencies,
      snapshot.digest.value,
    )

    expect(result).toMatchObject({ status: "completed", processable_count: 5, completed_count: 5 })
    expect(dependencies.graded).toHaveLength(5)
    for (const input of dependencies.graded) {
      expect(input.transcript.transcript.length).toBeLessThan(200_000)
      expect(input.transcript.transcript).toBe(GRADEABLE_TRANSCRIPT.split("\n").slice(2).join("\n"))
      expect(input.transcript.transcript).not.toContain("x".repeat(100))
    }
  })

  it("changes the v2 digest when private source content changes outside an identical bounded segment", async () => {
    const first = new RecordingRecoveryDependencies()
    first.canonicalStartIndex = 0
    first.transcript = `[handling agent]: source-a\n${GRADEABLE_TRANSCRIPT}`
    const second = new RecordingRecoveryDependencies()
    second.canonicalStartIndex = 0
    second.transcript = `[handling agent]: source-b\n${GRADEABLE_TRANSCRIPT}`

    const firstSnapshot = await inspectAchieveQaRecovery(first, callIds)
    const secondSnapshot = await inspectAchieveQaRecovery(second, callIds)
    if ("_tag" in firstSnapshot || "_tag" in secondSnapshot) throw new Error("fixture inspection failed")

    expect(firstSnapshot.digest.canonicalization).toBe("achieve-qa-gap-recovery-v2")
    expect(firstSnapshot.digest.value).not.toBe(secondSnapshot.digest.value)
    expect(firstSnapshot.processableInputs[0]?.input).toEqual(secondSnapshot.processableInputs[0]?.input)
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
