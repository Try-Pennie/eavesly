import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { MODULE_NAMES } from "../modules/constants"
import {
  AchieveBackfillCallIdSchema,
  type AchieveBackfillCallId,
} from "../schemas/achieve-backfill-dry-run"
import type { Bindings } from "../types/env"
import type {
  AchieveBackfillInspectionResult,
  AchieveBackfillInspector,
} from "./achieve-backfill-dry-run"

type IdOnlyReadResponse = {
  readonly data: unknown
  readonly error: unknown | null
}

type ExecuteIdOnlyReads = (
  callIds: ReadonlyArray<AchieveBackfillCallId>,
) => Promise<{
  readonly calls: IdOnlyReadResponse
  readonly ordinaryResults: IdOnlyReadResponse
}>

const IdOnlyRowsSchema = z.array(
  z.object({ call_id: AchieveBackfillCallIdSchema }).strict(),
)

const ResultConflictRowsSchema = z.array(
  z.object({
    call_id: AchieveBackfillCallIdSchema,
    audit_only_marker: z.unknown().optional().transform((marker) => marker === true),
  }).strict(),
)

function parseInspectionRows(
  requestedCallIds: ReadonlyArray<AchieveBackfillCallId>,
  calls: unknown,
  ordinaryResults: unknown,
): AchieveBackfillInspectionResult {
  const parsedCalls = IdOnlyRowsSchema.safeParse(calls)
  const parsedResults = ResultConflictRowsSchema.safeParse(ordinaryResults)
  if (!parsedCalls.success || !parsedResults.success) {
    return { _tag: "failure", reason: "invalid_response" }
  }

  const requested = new Set(requestedCallIds)
  const knownCallIds = parsedCalls.data.map((row) => row.call_id)
  // Only an exact JSON boolean true at result_json.backfill.audit_only is
  // exempt. Missing, null, string, and false markers are ordinary conflicts.
  const ordinaryResultCallIds = parsedResults.data
    .filter((row) => !row.audit_only_marker)
    .map((row) => row.call_id)
  if (
    knownCallIds.some((callId) => !requested.has(callId))
    || ordinaryResultCallIds.some((callId) => !requested.has(callId))
  ) {
    return { _tag: "failure", reason: "invalid_response" }
  }

  return {
    _tag: "success",
    knownCallIds,
    ordinaryResultCallIds,
  }
}

/**
 * Create the Supabase-backed ID-only inspector for PSAI-245 Gate 1.
 * The adapter issues exactly two SELECT projections and exposes no mutation API.
 */
export function createSupabaseAchieveBackfillInspector(
  env: Bindings,
  executeIdOnlyReads?: ExecuteIdOnlyReads,
): AchieveBackfillInspector {
  const execute: ExecuteIdOnlyReads = executeIdOnlyReads ?? (async (callIds) => {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const [calls, ordinaryResults] = await Promise.all([
      client
        .from("eavesly_calls")
        .select("call_id")
        .in("call_id", [...callIds]),
      client
        .from("eavesly_module_results")
        .select("call_id,audit_only_marker:result_json->backfill->audit_only")
        .eq("module_name", MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
        .in("call_id", [...callIds]),
    ])
    return { calls, ordinaryResults }
  })

  return {
    async inspect(callIds) {
      let response: Awaited<ReturnType<ExecuteIdOnlyReads>>
      try {
        response = await execute(callIds)
      } catch {
        return { _tag: "failure", reason: "read_unavailable" }
      }

      if (response.calls.error !== null || response.ordinaryResults.error !== null) {
        return { _tag: "failure", reason: "read_unavailable" }
      }

      return parseInspectionRows(
        callIds,
        response.calls.data,
        response.ordinaryResults.data,
      )
    },
  }
}
