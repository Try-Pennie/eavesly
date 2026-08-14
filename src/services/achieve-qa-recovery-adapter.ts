import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { MODULE_NAMES } from "../modules/constants"
import type { ModuleResult } from "../modules/types"
import { gradeAchieveWelcomeCallSegment } from "../modules/achieve-welcome-call-qa/module"
import {
  AchieveQaRecoveryCallIdSchema,
  type AchieveQaRecoveryCallId,
} from "../schemas/achieve-qa-recovery"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH,
  AchieveQaTranscriptRecoverySourceEventSchema,
} from "../schemas/achieve-qa-transcript-recovery"
import type { Bindings } from "../types/env"
import type {
  AchieveQaRecoveryCandidate,
  AchieveQaRecoveryExecutionDependencies,
  AchieveQaRecoveryInspector,
} from "./achieve-qa-recovery"
import { DatabaseService } from "./database"
import type { ResolverPolicy } from "./regal-events"
import {
  ACHIEVE_QA_RECOVERY_ONE_SHOT_LLM_PROFILE,
  createAchieveBackfillOneShotLlm,
} from "./achieve-backfill-one-shot-llm"

const CallRowsSchema = z.array(z.object({
  call_id: AchieveQaRecoveryCallIdSchema,
  disposition: z.string().nullable(),
  talk_time: z.number().nonnegative().nullable(),
  campaign_name: z.string().nullable(),
  sfdc_lead_id: z.string().min(1).nullable(),
  started_at: z.string().nullable(),
}).strict())

const TranscriptRowsSchema = z.array(z.object({
  call_id: AchieveQaRecoveryCallIdSchema,
  original_transcript: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
}).strict())

const EventRowsSchema = z.array(z.object({
  regal_task_id: AchieveQaRecoveryCallIdSchema,
  event_type: z.literal("transcript_available"),
  payload: z.unknown(),
}).strict())

const ResultRowsSchema = z.array(z.object({
  call_id: AchieveQaRecoveryCallIdSchema,
}).strict())

type BoundaryResponse = { readonly data: unknown; readonly error: unknown | null }
type RecoveryReads = {
  readonly calls: BoundaryResponse
  readonly transcripts: BoundaryResponse
  readonly events: BoundaryResponse
  readonly results: BoundaryResponse
}
type ExecuteRecoveryReads = (
  callIds: ReadonlyArray<AchieveQaRecoveryCallId>,
) => Promise<RecoveryReads>
type LoadResolverPolicy = () => Promise<ResolverPolicy>

function createSourceCandidate(
  call: z.infer<typeof CallRowsSchema>[number],
  transcript: string,
  sourceKind: "legacy_qa" | "canonical_event",
): AchieveQaRecoveryCandidate {
  if (
    call.sfdc_lead_id === null
    || transcript.length > ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH
  ) {
    return { callId: call.call_id, existingResult: false, source: null, inputStatus: "invalid_input" }
  }
  return {
    callId: call.call_id,
    existingResult: false,
    source: {
      sourceKind,
      transcript,
      metadata: {
        duration: call.talk_time ?? 0,
        timestamp: call.started_at ?? "",
        talk_time: call.talk_time ?? undefined,
        disposition: call.disposition ?? undefined,
        campaign_name: call.campaign_name ?? undefined,
      },
      sfdcLeadId: call.sfdc_lead_id,
    },
  }
}

/** Build the parsed Supabase inspector for the exact 17-call recovery artifact. */
export function createSupabaseAchieveQaRecoveryInspector(
  env: Bindings,
  executeReads?: ExecuteRecoveryReads,
  loadResolverPolicy?: LoadResolverPolicy,
): AchieveQaRecoveryInspector {
  const client: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const execute: ExecuteRecoveryReads = executeReads ?? (async (callIds) => {
    const [calls, transcripts, events, results] = await Promise.all([
      client.from("eavesly_calls")
        .select("call_id,disposition,talk_time,campaign_name,sfdc_lead_id,started_at")
        .in("call_id", [...callIds]),
      client.from("eavesly_transcription_qa")
        .select("call_id,original_transcript,created_at")
        .in("call_id", [...callIds])
        .order("created_at", { ascending: false }),
      client.from("eavesly_regal_call_events")
        .select("regal_task_id,event_type,payload")
        .eq("event_type", "transcript_available")
        .in("regal_task_id", [...callIds]),
      client.from("eavesly_module_results")
        .select("call_id")
        .eq("module_name", MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
        .in("call_id", [...callIds]),
    ])
    return { calls, transcripts, events, results }
  })

  return {
    async inspect(callIds) {
      let reads: RecoveryReads
      try {
        reads = await execute(callIds)
      } catch {
        return { _tag: "failure", reason: "read_unavailable" }
      }
      if (
        reads.calls.error !== null
        || reads.transcripts.error !== null
        || reads.events.error !== null
        || reads.results.error !== null
      ) {
        return { _tag: "failure", reason: "read_unavailable" }
      }

      const calls = CallRowsSchema.safeParse(reads.calls.data)
      const transcripts = TranscriptRowsSchema.safeParse(reads.transcripts.data)
      const events = EventRowsSchema.safeParse(reads.events.data)
      const results = ResultRowsSchema.safeParse(reads.results.data)
      if (!calls.success || !transcripts.success || !events.success || !results.success) {
        return { _tag: "failure", reason: "invalid_response" }
      }

      const requested = new Set(callIds)
      if (
        calls.data.some((row) => !requested.has(row.call_id))
        || transcripts.data.some((row) => !requested.has(row.call_id))
        || events.data.some((row) => !requested.has(row.regal_task_id))
        || results.data.some((row) => !requested.has(row.call_id))
      ) {
        return { _tag: "failure", reason: "invalid_response" }
      }

      const newestTranscriptByCallId = new Map<AchieveQaRecoveryCallId, {
        readonly createdAtMs: number
        readonly transcript: string
        readonly ambiguousTie: boolean
      }>()
      const invalidTranscriptIds = new Set<AchieveQaRecoveryCallId>()
      for (const row of transcripts.data) {
        const normalized = row.original_transcript?.trim()
        if (!normalized) {
          if (row.original_transcript !== null) invalidTranscriptIds.add(row.call_id)
          continue
        }

        const createdAtMs = Date.parse(row.created_at)
        const current = newestTranscriptByCallId.get(row.call_id)
        if (current === undefined || createdAtMs > current.createdAtMs) {
          newestTranscriptByCallId.set(row.call_id, {
            createdAtMs,
            transcript: row.original_transcript ?? normalized,
            ambiguousTie: false,
          })
          continue
        }
        if (createdAtMs === current.createdAtMs && row.original_transcript !== current.transcript) {
          newestTranscriptByCallId.set(row.call_id, { ...current, ambiguousTie: true })
        }
      }
      const eventTranscriptByCallId = new Map<AchieveQaRecoveryCallId, string>()
      const invalidEventIds = new Set<AchieveQaRecoveryCallId>()
      for (const row of events.data) {
        const event = AchieveQaTranscriptRecoverySourceEventSchema.safeParse(row.payload)
        if (!event.success || event.data.regal_task_id !== row.regal_task_id) {
          invalidEventIds.add(row.regal_task_id)
          continue
        }
        const transcript = event.data.transcript?.trim()
        if (!transcript) {
          invalidEventIds.add(row.regal_task_id)
          continue
        }
        if (eventTranscriptByCallId.has(row.regal_task_id)) {
          // The ledger primary key permits one row per task and event type. Any
          // duplicate response is ambiguous, even if its transcript happens to match.
          invalidEventIds.add(row.regal_task_id)
          continue
        }
        eventTranscriptByCallId.set(row.regal_task_id, event.data.transcript ?? transcript)
      }

      const existingResultIds = new Set(results.data.map((row) => row.call_id))
      const candidates = calls.data.map((call): AchieveQaRecoveryCandidate => {
        const selected = newestTranscriptByCallId.get(call.call_id)
        let candidate: AchieveQaRecoveryCandidate
        const eventTranscript = eventTranscriptByCallId.get(call.call_id)
        if (selected?.ambiguousTie) {
          candidate = {
            callId: call.call_id,
            existingResult: false,
            source: null,
            inputStatus: "invalid_input",
          }
        } else if (selected !== undefined) {
          candidate = invalidEventIds.has(call.call_id)
            || (eventTranscript !== undefined && eventTranscript !== selected.transcript)
            ? {
                callId: call.call_id,
                existingResult: false,
                source: null,
                inputStatus: "invalid_input",
              }
            : createSourceCandidate(call, selected.transcript, "legacy_qa")
        } else if (
          invalidTranscriptIds.has(call.call_id)
          || invalidEventIds.has(call.call_id)
        ) {
          candidate = {
            callId: call.call_id,
            existingResult: false,
            source: null,
            inputStatus: "invalid_input",
          }
        } else {
          candidate = eventTranscript === undefined
            ? {
                callId: call.call_id,
                existingResult: false,
                source: null,
                inputStatus: "transcript_unavailable",
              }
            : createSourceCandidate(call, eventTranscript, "canonical_event")
        }
        return { ...candidate, existingResult: existingResultIds.has(call.call_id) }
      })

      try {
        const policy = loadResolverPolicy === undefined
          ? (await new DatabaseService(env, client).getResolverPolicy()).policy
          : await loadResolverPolicy()
        return { _tag: "success", policy, candidates }
      } catch {
        return { _tag: "failure", reason: "read_unavailable" }
      }
    },
  }
}


type OrdinaryResultInsert = {
  readonly call_id: AchieveQaRecoveryCallId
  readonly module_name: string
  readonly result_json: unknown
  readonly has_violation: boolean
  readonly violation_type: string | null
  readonly alert_sent: false
  readonly alert_sent_at: null
  readonly processing_time_ms: number
}

type ExecuteOrdinaryResultInsert = (
  record: OrdinaryResultInsert,
) => Promise<{ readonly error: { readonly code?: unknown } | null }>

/** Build an insert-only finalizer that safely classifies the production unique-key race as already existing. */
export function createAchieveQaRecoveryInsertOnlyFinalizer(
  executeInsert: ExecuteOrdinaryResultInsert,
): AchieveQaRecoveryExecutionDependencies["finalize"] {
  return async (callId: AchieveQaRecoveryCallId, result: ModuleResult) => {
    if (
      typeof result.result === "object"
      && result.result !== null
      && !Array.isArray(result.result)
      && "grading_skipped" in result.result
      && result.result.grading_skipped === true
    ) {
      return { _tag: "failure", reason: "invalid_response" }
    }
    try {
      const { error } = await executeInsert({
        call_id: callId,
        module_name: result.module_name,
        result_json: result.result,
        has_violation: result.has_violation,
        violation_type: result.violation_type,
        alert_sent: false,
        alert_sent_at: null,
        processing_time_ms: result.processing_time_ms,
      })
      if (error === null) return { _tag: "inserted" }
      // Production enforces UNIQUE(call_id,module_name). INSERT never updates the
      // winner; a concurrent ordinary or frozen audit row is preserved verbatim.
      if (error.code === "23505") return { _tag: "already_exists" }
      return { _tag: "failure", reason: "write_unavailable" }
    } catch {
      return { _tag: "failure", reason: "write_unavailable" }
    }
  }
}

/** Build production no-alert, one-shot execution capabilities for the dedicated recovery Workflow. */
export function createSupabaseAchieveQaRecoveryDependencies(
  env: Bindings,
): AchieveQaRecoveryExecutionDependencies {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const inspector = createSupabaseAchieveQaRecoveryInspector(env)
  const llm = createAchieveBackfillOneShotLlm(
    env,
    undefined,
    ACHIEVE_QA_RECOVERY_ONE_SHOT_LLM_PROFILE,
  )

  const finalize = createAchieveQaRecoveryInsertOnlyFinalizer(async (record) => {
    return client.from("eavesly_module_results").insert(record)
  })

  return {
    inspect: inspector.inspect,
    async hasExistingResult(callId) {
      try {
        const response = await client.from("eavesly_module_results")
          .select("call_id")
          .eq("call_id", callId)
          .eq("module_name", MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
          .limit(1)
        if (response.error !== null) return { _tag: "failure", reason: "read_unavailable" }
        const parsed = ResultRowsSchema.safeParse(response.data)
        if (!parsed.success || parsed.data.some((row) => row.call_id !== callId)) {
          return { _tag: "failure", reason: "invalid_response" }
        }
        return { _tag: "success", exists: parsed.data.length > 0 }
      } catch {
        return { _tag: "failure", reason: "read_unavailable" }
      }
    },
    async grade(candidate) {
      try {
        const result = await gradeAchieveWelcomeCallSegment(
          candidate.segment,
          candidate.input,
          llm,
        )
        return { _tag: "success", result }
      } catch {
        return { _tag: "failure", reason: "grading_unavailable" }
      }
    },
    finalize,
  }
}
