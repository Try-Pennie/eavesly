import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { ModuleResult } from "../modules/types"
import { segmentWelcomeCall } from "../modules/achieve-welcome-call-qa/segment"
import { AchieveBackfillCallIdSchema, type AchieveBackfillCallId } from "../schemas/achieve-backfill-dry-run"
import type { Bindings } from "../types/env"
import {
  createProductionAchieveBackfillGrader,
  type GradeAchieveBackfillCanary,
} from "./achieve-backfill-canary-adapter"
import { createAchieveBackfillOneShotLlm } from "./achieve-backfill-one-shot-llm"
import type {
  AchieveBackfillRemaining56Context,
  AchieveBackfillRemaining56Dependencies,
  AchieveBackfillRemaining56PostClaimFailure,
  AchieveBackfillRemaining56Insert,
} from "./achieve-backfill-remaining56"

const SingleStatusSchema = <T extends z.ZodTypeAny>(status: T) => z.array(z.object({ status }).strict()).length(1)
const InitializeSchema = SingleStatusSchema(z.enum([
  "ready", "completed_canary_missing", "cohort_conflict", "different_progress",
]))
const ClaimSchema = z.array(z.object({
  status: z.enum(["claimed", "attempted", "completed", "failed", "rejected"]),
}).strict()).length(1)
const FinalizeSchema = SingleStatusSchema(z.enum(["inserted", "already_completed", "rejected"]))
const FailureSchema = SingleStatusSchema(z.enum(["recorded", "already_recorded", "rejected"]))
const TranscriptRowsSchema = z.array(z.object({
  call_id: AchieveBackfillCallIdSchema,
  original_transcript: z.string().min(1).max(200_000),
}).strict()).length(1)

type BoundaryResponse = { readonly data: unknown; readonly error: unknown | null }

/** Raw service-role operations hidden behind the parsed remaining-56 adapter. */
export interface AchieveBackfillRemaining56DataAccess {
  /** Initialize/replay the exact progress cohort. */
  initialize(context: AchieveBackfillRemaining56Context): Promise<BoundaryResponse>
  /** Irreversibly claim one approved progress row. */
  claim(context: AchieveBackfillRemaining56Context, callId: AchieveBackfillCallId): Promise<BoundaryResponse>
  /** Fetch only one claimed transcript. */
  loadTranscript(callId: AchieveBackfillCallId): Promise<BoundaryResponse>
  /** Atomically insert one audit row and complete its progress. */
  finalize(context: AchieveBackfillRemaining56Context, record: AchieveBackfillRemaining56Insert): Promise<BoundaryResponse>
  /** Persist a categorical terminal failure for one claimed item. */
  recordFailure(
    context: AchieveBackfillRemaining56Context,
    callId: AchieveBackfillCallId,
    reason: AchieveBackfillRemaining56PostClaimFailure,
  ): Promise<BoundaryResponse>
}

function contextRpc(context: AchieveBackfillRemaining56Context) {
  return {
    p_call_ids: [...context.callIds],
    p_completed_canary_call_id: context.completedCanaryCallId,
    p_approved_digest: context.approvedDigest,
    p_manifest_version: context.manifestVersion,
    p_snapshot_cutoff: context.snapshotCutoff,
  }
}

function createDataAccess(env: Bindings): AchieveBackfillRemaining56DataAccess {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return {
    async initialize(context) {
      return client.rpc("eavesly_initialize_achieve_backfill_remaining56_v1", contextRpc(context))
    },
    async claim(context, callId) {
      return client.rpc("eavesly_claim_achieve_backfill_remaining56_v1", {
        p_call_id: callId,
        p_approved_digest: context.approvedDigest,
        p_completed_canary_call_id: context.completedCanaryCallId,
      })
    },
    async loadTranscript(callId) {
      return client.from("eavesly_transcription_qa")
        .select("call_id,original_transcript")
        .eq("call_id", callId)
        .limit(2)
    },
    async finalize(context, record) {
      const result = record.moduleResult.result
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        return { data: null, error: { code: "invalid_result" } }
      }
      return client.rpc("eavesly_finalize_achieve_backfill_remaining56_v1", {
        p_call_id: record.callId,
        p_result_json: result,
        p_has_violation: record.moduleResult.has_violation,
        p_violation_type: record.moduleResult.violation_type,
        p_processing_time_ms: record.moduleResult.processing_time_ms,
        p_approved_digest: context.approvedDigest,
        p_completed_canary_call_id: context.completedCanaryCallId,
      })
    },
    async recordFailure(context, callId, reason) {
      return client.rpc("eavesly_fail_achieve_backfill_remaining56_v1", {
        p_call_id: callId,
        p_reason: reason,
        p_approved_digest: context.approvedDigest,
        p_completed_canary_call_id: context.completedCanaryCallId,
      })
    },
  }
}

async function boundaryCall(
  operation: () => Promise<BoundaryResponse>,
): Promise<BoundaryResponse | undefined> {
  try {
    const response = await operation()
    return response.error === null ? response : undefined
  } catch {
    return undefined
  }
}

/** Build the remaining-56 grader with no application or OpenAI SDK retries. */
export function createProductionAchieveBackfillRemaining56Grader(
  env: Bindings,
): GradeAchieveBackfillCanary {
  return createProductionAchieveBackfillGrader(
    env,
    createAchieveBackfillOneShotLlm(env),
  )
}

/** Create production remaining-56 dependencies with parsed RPC and private grading boundaries. */
export function createSupabaseAchieveBackfillRemaining56Dependencies(
  env: Bindings,
  dataAccess: AchieveBackfillRemaining56DataAccess = createDataAccess(env),
  grade: GradeAchieveBackfillCanary = createProductionAchieveBackfillRemaining56Grader(env),
): AchieveBackfillRemaining56Dependencies {
  return {
    async initialize(context) {
      const response = await boundaryCall(() => dataAccess.initialize(context))
      if (response === undefined) return { _tag: "failure", reason: "write_unavailable" }
      const parsed = InitializeSchema.safeParse(response.data)
      if (!parsed.success) return { _tag: "failure", reason: "invalid_response" }
      const status = parsed.data[0].status
      if (status === "ready") return { _tag: "ready" }
      return { _tag: "rejected", reason: status }
    },
    async prepare(callId) {
      const response = await boundaryCall(() => dataAccess.loadTranscript(callId))
      if (response === undefined) return { _tag: "failure", reason: "transcript_unavailable" }
      const parsed = TranscriptRowsSchema.safeParse(response.data)
      if (!parsed.success || parsed.data[0].call_id !== callId) {
        return { _tag: "failure", reason: "invalid_response" }
      }
      const transcript = parsed.data[0].original_transcript
      if (!segmentWelcomeCall(transcript).segment_found) {
        return { _tag: "failure", reason: "segment_unavailable" }
      }
      return { _tag: "ready", transcript }
    },
    async claim(context, callId) {
      const response = await boundaryCall(() => dataAccess.claim(context, callId))
      if (response === undefined) return { _tag: "failure", reason: "write_unavailable" }
      const parsed = ClaimSchema.safeParse(response.data)
      if (!parsed.success) return { _tag: "failure", reason: "invalid_response" }
      const status = parsed.data[0].status
      if (status === "claimed") return { _tag: "claimed" }
      if (status === "rejected") return { _tag: "rejected" }
      return { _tag: "already_attempted", status }
    },
    async grade(callId, transcript) {
      let result: ModuleResult
      try {
        result = await grade(callId, transcript)
      } catch {
        return { _tag: "failure", reason: "grading_unavailable" }
      }
      return { _tag: "success", result }
    },
    async finalize(context, record) {
      const response = await boundaryCall(() => dataAccess.finalize(context, record))
      if (response === undefined) return { _tag: "failure", reason: "write_unavailable" }
      const parsed = FinalizeSchema.safeParse(response.data)
      if (!parsed.success) return { _tag: "failure", reason: "invalid_response" }
      const status = parsed.data[0].status
      return status === "rejected" ? { _tag: "rejected" } : { _tag: status }
    },
    async recordFailure(context, callId, reason) {
      const response = await boundaryCall(() => dataAccess.recordFailure(context, callId, reason))
      if (response === undefined) return { _tag: "failure" }
      const parsed = FailureSchema.safeParse(response.data)
      if (!parsed.success || parsed.data[0].status === "rejected") return { _tag: "failure" }
      return { _tag: parsed.data[0].status }
    },
  }
}
