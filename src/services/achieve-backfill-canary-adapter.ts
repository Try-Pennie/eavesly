import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { achieveWelcomeCallQAModule } from "../modules/achieve-welcome-call-qa/module"
import { MODULE_NAMES } from "../modules/constants"
import type { ModuleResult } from "../modules/types"
import {
  AchieveBackfillCallIdSchema,
  type AchieveBackfillCallId,
} from "../schemas/achieve-backfill-dry-run"
import type { EvaluateRequest } from "../schemas/requests"
import type { Bindings } from "../types/env"
import { modelForModule } from "./model-selection"
import { createLLMClient, type LLMClient } from "./llm-client"
import type {
  AchieveBackfillCanaryDependencies,
  AchieveBackfillCanaryInsert,
  AchieveBackfillCanaryInspection,
} from "./achieve-backfill-canary"

const NullableTextSchema = z.string().nullable().optional().transform((value) => value ?? null)
const NullableCallIdSchema = AchieveBackfillCallIdSchema.nullable().optional().transform((value) => value ?? null)

const CallRowsSchema = z.array(z.object({ call_id: AchieveBackfillCallIdSchema }).strict())
const ResultRowsSchema = z.array(z.object({
  call_id: AchieveBackfillCallIdSchema,
  audit_only_marker: z.unknown().optional().transform((value) => value === true),
  approved_digest: NullableTextSchema,
  batch_id: NullableTextSchema,
  canary_id: NullableTextSchema,
  canary_call_id: NullableCallIdSchema,
  manifest_version: NullableTextSchema,
  snapshot_cutoff: NullableTextSchema,
}).strict())
const TranscriptRowsSchema = z.array(z.object({
  call_id: AchieveBackfillCallIdSchema,
  original_transcript: z.string().min(1).max(200_000),
}).strict()).length(1)
const FinalizeRowsSchema = z.array(z.object({
  status: z.enum(["inserted", "already_completed", "rejected"]),
  reason: z.enum([
    "unknown_call_ids",
    "ordinary_results_exist",
    "different_audit_provenance",
    "canary_already_used",
  ]).nullable(),
}).strict()).length(1)

type BoundaryResponse = { readonly data: unknown; readonly error: unknown | null }

/** Complete input to the atomic database finalization boundary. */
export type AchieveBackfillCanaryFinalize = {
  readonly callIds: ReadonlyArray<AchieveBackfillCallId>
  readonly record: AchieveBackfillCanaryInsert
}

/** Raw Supabase operations kept behind the parsed Gate 2 adapter. */
export interface AchieveBackfillCanaryDataAccess {
  /** Execute the immediate ID/categorical recheck. */
  inspect(callIds: ReadonlyArray<AchieveBackfillCallId>): Promise<{
    readonly calls: BoundaryResponse
    readonly results: BoundaryResponse
  }>
  /** Privately fetch only the selected transcript. */
  loadTranscript(callId: AchieveBackfillCallId): Promise<BoundaryResponse>
  /** Atomically final-recheck and insert through the service-role-only RPC. */
  finalize(input: AchieveBackfillCanaryFinalize): Promise<BoundaryResponse>
}

/** Production grading operation used after all approval and conflict checks pass. */
export type GradeAchieveBackfillCanary = (
  callId: AchieveBackfillCallId,
  transcript: string,
) => Promise<ModuleResult>

function parseInspection(
  requestedCallIds: ReadonlyArray<AchieveBackfillCallId>,
  calls: unknown,
  results: unknown,
): AchieveBackfillCanaryInspection {
  const parsedCalls = CallRowsSchema.safeParse(calls)
  const parsedResults = ResultRowsSchema.safeParse(results)
  if (!parsedCalls.success || !parsedResults.success) {
    return { _tag: "failure", reason: "invalid_response" }
  }

  const requested = new Set(requestedCallIds)
  if (
    parsedCalls.data.some((row) => !requested.has(row.call_id))
    || parsedResults.data.some((row) => !requested.has(row.call_id))
  ) {
    return { _tag: "failure", reason: "invalid_response" }
  }

  return {
    _tag: "success",
    knownCallIds: parsedCalls.data.map((row) => row.call_id),
    existingResults: parsedResults.data.map((row) => ({
      callId: row.call_id,
      provenance: {
        auditOnly: row.audit_only_marker,
        approvedDigest: row.approved_digest,
        batchId: row.batch_id,
        canaryId: row.canary_id,
        canaryCallId: row.canary_call_id,
        manifestVersion: row.manifest_version,
        snapshotCutoff: row.snapshot_cutoff,
      },
    })),
  }
}

function createSupabaseDataAccess(env: Bindings): AchieveBackfillCanaryDataAccess {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return {
    async inspect(callIds) {
      const [calls, results] = await Promise.all([
        client.from("eavesly_calls")
          .select("call_id")
          .in("call_id", [...callIds]),
        client.from("eavesly_module_results")
          .select([
            "call_id",
            "audit_only_marker:result_json->backfill->audit_only",
            "approved_digest:result_json->backfill->>approved_digest",
            "batch_id:result_json->backfill->>batch_id",
            "canary_id:result_json->backfill->>canary_id",
            "canary_call_id:result_json->backfill->>canary_call_id",
            "manifest_version:result_json->backfill->>manifest_version",
            "snapshot_cutoff:result_json->backfill->>snapshot_cutoff",
          ].join(","))
          .eq("module_name", MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
          .in("call_id", [...callIds]),
      ])
      return { calls, results }
    },
    async loadTranscript(callId) {
      return client.from("eavesly_transcription_qa")
        .select("call_id,original_transcript")
        .eq("call_id", callId)
        .limit(2)
    },
    async finalize({ callIds, record }) {
      if (typeof record.moduleResult.result !== "object" || record.moduleResult.result === null) {
        return { data: null, error: { code: "invalid_result" } }
      }
      const backfill = "backfill" in record.moduleResult.result
        ? record.moduleResult.result.backfill
        : undefined
      if (typeof backfill !== "object" || backfill === null || !("approved_digest" in backfill)
        || !("manifest_version" in backfill) || !("snapshot_cutoff" in backfill)) {
        return { data: null, error: { code: "invalid_result" } }
      }
      return client.rpc("eavesly_finalize_achieve_backfill_canary_v1", {
        p_call_ids: [...callIds],
        p_canary_call_id: record.callId,
        p_result_json: record.moduleResult.result,
        p_has_violation: record.moduleResult.has_violation,
        p_violation_type: record.moduleResult.violation_type,
        p_processing_time_ms: record.moduleResult.processing_time_ms,
        p_approved_digest: backfill.approved_digest,
        p_manifest_version: backfill.manifest_version,
        p_snapshot_cutoff: backfill.snapshot_cutoff,
      })
    },
  }
}

/** Build the actual Achieve module grader while keeping transcripts private. */
export function createProductionAchieveBackfillGrader(
  env: Bindings,
  llm: LLMClient = createLLMClient(
    env,
    modelForModule(env, MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA),
    { invalidResponseLogging: "categorical_only" },
  ),
): GradeAchieveBackfillCanary {
  return async (callId, transcript) => {
    const callData: EvaluateRequest = {
      call_id: callId,
      agent_id: "psai-245-gate-2-audit",
      transcript: {
        transcript,
        metadata: {
          duration: 0,
          timestamp: "2026-08-11T16:21:44.777859Z",
        },
      },
    }
    return achieveWelcomeCallQAModule.evaluate(transcript, callData, llm, null)
  }
}

/**
 * Create the parsed Supabase/production-module dependencies for Gate 2.
 * Final persistence uses the service-role-only atomic recheck/plain-insert RPC.
 */
export function createSupabaseAchieveBackfillCanaryDependencies(
  env: Bindings,
  dataAccess: AchieveBackfillCanaryDataAccess = createSupabaseDataAccess(env),
  grade: GradeAchieveBackfillCanary = createProductionAchieveBackfillGrader(env),
): AchieveBackfillCanaryDependencies {
  return {
    async inspect(callIds) {
      let response: Awaited<ReturnType<AchieveBackfillCanaryDataAccess["inspect"]>>
      try {
        response = await dataAccess.inspect(callIds)
      } catch {
        return { _tag: "failure", reason: "read_unavailable" }
      }
      if (response.calls.error !== null || response.results.error !== null) {
        return { _tag: "failure", reason: "read_unavailable" }
      }
      return parseInspection(callIds, response.calls.data, response.results.data)
    },
    async loadTranscript(callId) {
      let response: BoundaryResponse
      try {
        response = await dataAccess.loadTranscript(callId)
      } catch {
        return { _tag: "failure", reason: "transcript_unavailable" }
      }
      if (response.error !== null) {
        return { _tag: "failure", reason: "transcript_unavailable" }
      }
      const parsed = TranscriptRowsSchema.safeParse(response.data)
      if (!parsed.success || parsed.data[0].call_id !== callId) {
        return { _tag: "failure", reason: "invalid_response" }
      }
      return { _tag: "success", transcript: parsed.data[0].original_transcript }
    },
    async grade(callId, transcript) {
      try {
        const result = await grade(callId, transcript)
        return { _tag: "success", result }
      } catch {
        return { _tag: "failure", reason: "grading_unavailable" }
      }
    },
    async finalize(callIds, record) {
      let response: BoundaryResponse
      try {
        response = await dataAccess.finalize({ callIds, record })
      } catch {
        return { _tag: "failure", reason: "write_unavailable" }
      }
      if (response.error !== null) {
        return { _tag: "failure", reason: "write_unavailable" }
      }
      const parsed = FinalizeRowsSchema.safeParse(response.data)
      if (!parsed.success) {
        return { _tag: "failure", reason: "invalid_response" }
      }
      const row = parsed.data[0]
      if (row.status === "inserted" && row.reason === null) return { _tag: "inserted" }
      if (row.status === "already_completed" && row.reason === null) {
        return { _tag: "already_completed" }
      }
      if (row.status === "rejected" && row.reason !== null) {
        return { _tag: "rejected", reason: row.reason }
      }
      return { _tag: "failure", reason: "invalid_response" }
    },
  }
}
