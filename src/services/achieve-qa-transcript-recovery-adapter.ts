import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  AchieveQaTranscriptRecoverySourceEventSchema,
  type AchieveQaTranscriptRecoverySourceEvent,
} from "../schemas/achieve-qa-transcript-recovery"
import {
  AchieveQaRecoveryCallIdSchema,
  type AchieveQaRecoveryCallId,
} from "../schemas/achieve-qa-recovery"
import type { Bindings } from "../types/env"
import { canonicalizeJson } from "./canonical-json"
import type {
  AchieveQaTranscriptRecoveryLedger,
  AchieveQaTranscriptRecoveryLedgerInspection,
} from "./achieve-qa-transcript-recovery"

const PersistedEventRowsSchema = z.array(z.object({
  regal_task_id: AchieveQaRecoveryCallIdSchema,
  event_type: z.literal("transcript_available"),
  payload: z.unknown(),
}).strict())

type BoundaryResponse = { readonly data: unknown; readonly error: unknown | null }
type ExecuteEventReads = (
  callIds: ReadonlyArray<AchieveQaRecoveryCallId>,
) => Promise<BoundaryResponse>

type EventInsertRecord = {
  readonly regal_task_id: AchieveQaRecoveryCallId
  readonly event_type: "transcript_available"
  readonly agent_email: string | null
  readonly source_event_id: string | null
  readonly payload: AchieveQaTranscriptRecoverySourceEvent
}

type ExecuteEventInsert = (
  records: ReadonlyArray<EventInsertRecord>,
) => Promise<{ readonly error: { readonly code?: unknown } | null }>

function compareEvents(
  left: AchieveQaTranscriptRecoverySourceEvent,
  right: AchieveQaTranscriptRecoverySourceEvent,
): boolean {
  const leftCanonical = canonicalizeJson(left)
  const rightCanonical = canonicalizeJson(right)
  return leftCanonical._tag === "success"
    && rightCanonical._tag === "success"
    && leftCanonical.value === rightCanonical.value
}

/** Build the insert-only Supabase ledger adapter for exact twelve-event recovery. */
export function createSupabaseAchieveQaTranscriptRecoveryLedger(
  env: Bindings,
  executeReads?: ExecuteEventReads,
  executeInsert?: ExecuteEventInsert,
): AchieveQaTranscriptRecoveryLedger {
  const client: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const read: ExecuteEventReads = executeReads ?? (async (callIds) => {
    return client.from("eavesly_regal_call_events")
      .select("regal_task_id,event_type,payload")
      .eq("event_type", "transcript_available")
      .in("regal_task_id", [...callIds])
  })
  const insert: ExecuteEventInsert = executeInsert ?? (async (records) => {
    return client.from("eavesly_regal_call_events").insert([...records])
  })

  async function inspect(
    events: ReadonlyArray<AchieveQaTranscriptRecoverySourceEvent>,
  ): Promise<AchieveQaTranscriptRecoveryLedgerInspection> {
    let response: BoundaryResponse
    try {
      response = await read(events.map((event) => event.regal_task_id))
    } catch {
      return { _tag: "failure", reason: "read_unavailable" }
    }
    if (response.error !== null) return { _tag: "failure", reason: "read_unavailable" }

    const rows = PersistedEventRowsSchema.safeParse(response.data)
    if (!rows.success) return { _tag: "failure", reason: "malformed_state" }

    const requested = new Map(events.map((event) => [event.regal_task_id, event]))
    const persisted = new Map<AchieveQaRecoveryCallId, AchieveQaTranscriptRecoverySourceEvent>()
    for (const row of rows.data) {
      const source = requested.get(row.regal_task_id)
      if (source === undefined) return { _tag: "failure", reason: "invalid_response" }
      if (persisted.has(source.regal_task_id)) {
        return { _tag: "failure", reason: "malformed_state" }
      }
      const payload = AchieveQaTranscriptRecoverySourceEventSchema.safeParse(row.payload)
      if (!payload.success || payload.data.regal_task_id !== source.regal_task_id) {
        return { _tag: "failure", reason: "malformed_state" }
      }
      persisted.set(source.regal_task_id, payload.data)
    }

    if (persisted.size === 0) return { _tag: "success", state: "absent" }
    if (persisted.size !== ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT) {
      return { _tag: "failure", reason: "partial_state" }
    }
    for (const event of events) {
      const stored = persisted.get(event.regal_task_id)
      if (stored === undefined || !compareEvents(stored, event)) {
        return { _tag: "failure", reason: "conflict_state" }
      }
    }
    return { _tag: "success", state: "identical" }
  }

  return {
    inspect,
    async restore(events) {
      const before = await inspect(events)
      if (before._tag === "failure") return before
      if (before.state === "identical") return { _tag: "already_restored" }

      const records = events.map((event): EventInsertRecord => ({
        regal_task_id: event.regal_task_id,
        event_type: "transcript_available",
        agent_email: event.agent_email ?? null,
        source_event_id: event.source_event_id ?? null,
        payload: event,
      }))
      let response: { readonly error: { readonly code?: unknown } | null }
      try {
        response = await insert(records)
      } catch {
        return { _tag: "failure", reason: "write_unavailable" }
      }
      if (response.error === null) return { _tag: "restored" }
      if (response.error.code !== "23505") {
        return { _tag: "failure", reason: "write_unavailable" }
      }

      const afterRace = await inspect(events)
      if (afterRace._tag === "success" && afterRace.state === "identical") {
        return { _tag: "already_restored" }
      }
      return afterRace._tag === "failure"
        ? afterRace
        : { _tag: "failure", reason: "conflict_state" }
    },
  }
}
