import { describe, expect, it } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  AchieveQaTranscriptRecoverySourceEventSchema,
} from "../schemas/achieve-qa-transcript-recovery"
import { createSupabaseAchieveQaTranscriptRecoveryLedger } from "./achieve-qa-transcript-recovery-adapter"

const events = Array.from(
  { length: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT },
  (_, index) => AchieveQaTranscriptRecoverySourceEventSchema.parse({
    event_type: "transcript_available",
    regal_task_id: `achieve-gap-${String(index + 1).padStart(2, "0")}`,
    transcript: `private transcript ${index + 1}`,
    transcript_is_truncated: false,
    source_event_id: `snowflake-event-${index + 1}`,
  }),
)

function rows(source = events) {
  return source.map((event) => ({
    regal_task_id: event.regal_task_id,
    event_type: "transcript_available" as const,
    payload: event,
  }))
}

describe("Achieve QA transcript recovery ledger adapter", () => {
  it("bulk-inserts all twelve canonical events only when every row is absent", async () => {
    const inserts: Array<unknown> = []
    const ledger = createSupabaseAchieveQaTranscriptRecoveryLedger(
      createEnv(),
      async () => ({ data: [], error: null }),
      async (records) => {
        inserts.push(records)
        return { error: null }
      },
    )

    expect(await ledger.inspect(events)).toEqual({ _tag: "success", state: "absent" })
    expect(await ledger.restore(events)).toEqual({ _tag: "restored" })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toEqual(events.map((event) => ({
      regal_task_id: event.regal_task_id,
      event_type: "transcript_available",
      agent_email: event.agent_email ?? null,
      source_event_id: event.source_event_id,
      payload: event,
    })))
  })

  it("treats an exact existing twelve-row snapshot as an idempotent replay", async () => {
    let inserts = 0
    const ledger = createSupabaseAchieveQaTranscriptRecoveryLedger(
      createEnv(),
      async () => ({ data: rows(), error: null }),
      async () => {
        inserts += 1
        return { error: null }
      },
    )

    expect(await ledger.inspect(events)).toEqual({ _tag: "success", state: "identical" })
    expect(await ledger.restore(events)).toEqual({ _tag: "already_restored" })
    expect(inserts).toBe(0)
  })

  it.each([
    ["partial_state", rows().slice(0, 1)],
    ["conflict_state", rows(events.map((event, index) => index === 0 ? { ...event, transcript: "different" } : event))],
    ["malformed_state", rows().map((row, index) => index === 0 ? { ...row, payload: { event_type: "transcript_available" } } : row)],
  ] as const)("fails closed on %s", async (reason, data) => {
    let inserts = 0
    const ledger = createSupabaseAchieveQaTranscriptRecoveryLedger(
      createEnv(),
      async () => ({ data, error: null }),
      async () => {
        inserts += 1
        return { error: null }
      },
    )

    expect(await ledger.inspect(events)).toEqual({ _tag: "failure", reason })
    expect(await ledger.restore(events)).toEqual({ _tag: "failure", reason })
    expect(inserts).toBe(0)
  })

  it("rechecks a unique-key race and succeeds only when all twelve winners are identical", async () => {
    let reads = 0
    const ledger = createSupabaseAchieveQaTranscriptRecoveryLedger(
      createEnv(),
      async () => {
        reads += 1
        return { data: reads === 1 ? [] : rows(), error: null }
      },
      async () => ({ error: { code: "23505" } }),
    )

    expect(await ledger.restore(events)).toEqual({ _tag: "already_restored" })
    expect(reads).toBe(2)
  })
})
