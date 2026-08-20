import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { ProgramExpectationsHistoryService } from "./program-expectations-history"

type Response = { readonly data: unknown; readonly error: unknown | null }
type RecordedFilter = {
  readonly table: string
  readonly operation: string
  readonly column: string
  readonly value: unknown
}

class FakeQuery implements PromiseLike<Response> {
  constructor(
    private readonly table: string,
    private readonly response: Response,
    private readonly filters: RecordedFilter[],
  ) {}

  select(): this { return this }
  eq(column: string, value: unknown): this {
    this.filters.push({ table: this.table, operation: "eq", column, value })
    return this
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ table: this.table, operation: "neq", column, value })
    return this
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ table: this.table, operation: "lt", column, value })
    return this
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ table: this.table, operation: "gte", column, value })
    return this
  }
  in(column: string, value: unknown): this {
    this.filters.push({ table: this.table, operation: "in", column, value })
    return this
  }
  order(): this { return this }
  limit(): this { return this }
  maybeSingle(): Promise<Response> { return Promise.resolve(this.response) }
  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected)
  }
}

function fakeClient(options: {
  readonly currentLead?: string | null
  readonly currentStartedAt?: string | null
  readonly eventTranscript?: string
  readonly qaTranscript?: string
  readonly currentReadError?: unknown
}) {
  const filters: RecordedFilter[] = []
  let callReads = 0
  const client = {
    from(table: string) {
      let response: Response
      if (table === "eavesly_calls") {
        callReads += 1
        response = callReads === 1
          ? {
              data: {
                sfdc_lead_id: options.currentLead ?? "lead-1",
                started_at: options.currentStartedAt ?? "2026-08-19T22:00:00Z",
              },
              error: options.currentReadError ?? null,
            }
          : {
              data: [{
                call_id: "prior-1",
                started_at: "2026-08-19T20:00:00Z",
                agent_email: "joel@example.com",
                talk_time: 2_940,
              }],
              error: null,
            }
      } else if (table === "eavesly_regal_call_events") {
        response = {
          data: options.eventTranscript === undefined ? [] : [{
            regal_task_id: "prior-1",
            payload: {
              event_type: "transcript_available",
              regal_task_id: "prior-1",
              transcript: options.eventTranscript,
              transcript_is_truncated: false,
            },
          }],
          error: null,
        }
      } else if (table === "eavesly_transcription_qa") {
        response = {
          data: options.qaTranscript === undefined ? [] : [{
            call_id: "prior-1",
            original_transcript: options.qaTranscript,
            created_at: "2026-08-19T20:55:00Z",
          }],
          error: null,
        }
      } else {
        response = { data: [], error: null }
      }
      return new FakeQuery(table, response, filters)
    },
  }

  // SAFETY: the fake implements the exact fluent Supabase surface used by lookup().
  return { client: client as unknown as SupabaseClient, filters }
}

describe("ProgramExpectationsHistoryService", () => {
  it("loads only strictly earlier exact-lead calls and prefers the Regal transcript", async () => {
    const fake = fakeClient({
      eventTranscript: "[handling agent]: canonical event transcript",
      qaTranscript: "[handling agent]: QA fallback transcript",
    })
    const service = new ProgramExpectationsHistoryService(createEnv(), fake.client)
    const result = await service.lookup({
      currentCallId: "current-1",
      expectedLeadId: "lead-1",
      expectedStartedAt: "2026-08-19T22:00:00Z",
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.calls[0]?.transcript).toContain("canonical event transcript")
    expect(result.calls[0]?.transcript_source).toBe("regal_event")
    expect(fake.filters).toContainEqual({
      table: "eavesly_calls",
      operation: "eq",
      column: "sfdc_lead_id",
      value: "lead-1",
    })
    expect(fake.filters).toContainEqual({
      table: "eavesly_calls",
      operation: "lt",
      column: "started_at",
      value: "2026-08-19T22:00:00.000Z",
    })
  })

  it("falls back to the QA transcript when no canonical event transcript exists", async () => {
    const fake = fakeClient({ qaTranscript: "[handling agent]: QA fallback transcript" })
    const service = new ProgramExpectationsHistoryService(createEnv(), fake.client)
    const result = await service.lookup({
      currentCallId: "current-1",
      expectedLeadId: "lead-1",
      expectedStartedAt: "2026-08-19T22:00:00Z",
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.calls[0]?.transcript_source).toBe("legacy_qa")
  })

  it("holds for review when the current-call identity read fails", async () => {
    const fake = fakeClient({ currentReadError: { message: "unavailable" } })
    const service = new ProgramExpectationsHistoryService(createEnv(), fake.client)
    const result = await service.lookup({
      currentCallId: "current-1",
      expectedLeadId: "lead-1",
      expectedStartedAt: "2026-08-19T22:00:00Z",
    })

    expect(result).toEqual({ status: "needs_review", reason: "dependency_failure" })
  })

  it("holds for review when persisted and event lead identities disagree", async () => {
    const fake = fakeClient({ currentLead: "different-lead" })
    const service = new ProgramExpectationsHistoryService(createEnv(), fake.client)
    const result = await service.lookup({
      currentCallId: "current-1",
      expectedLeadId: "lead-1",
      expectedStartedAt: "2026-08-19T22:00:00Z",
    })

    expect(result).toEqual({ status: "needs_review", reason: "identity_unproven" })
  })
})
