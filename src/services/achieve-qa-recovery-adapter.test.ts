import { describe, expect, it } from "vitest"
import { MODULE_NAMES } from "../modules/constants"
import { AchieveQaRecoveryCallIdSchema } from "../schemas/achieve-qa-recovery"
import { createEnv } from "../../test/helpers/mock-env"
import { DEFAULT_RESOLVER_POLICY } from "./regal-events"
import {
  createAchieveQaRecoveryInsertOnlyFinalizer,
  createSupabaseAchieveQaRecoveryInspector,
} from "./achieve-qa-recovery-adapter"

const recoveryCallId = AchieveQaRecoveryCallIdSchema.parse("approved-gap-01")

async function inspectRecoveryRows({
  transcripts = [],
  events = [],
}: {
  readonly transcripts?: ReadonlyArray<unknown>
  readonly events?: ReadonlyArray<unknown>
}) {
  const inspector = createSupabaseAchieveQaRecoveryInspector(
    createEnv(),
    async () => ({
      calls: {
        data: [{
          call_id: recoveryCallId,
          disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
          talk_time: 301,
          campaign_name: null,
          sfdc_lead_id: "lead-01",
          started_at: "2026-08-12T00:00:00Z",
        }],
        error: null,
      },
      transcripts: { data: transcripts, error: null },
      events: { data: events, error: null },
      results: { data: [], error: null },
    }),
    async () => DEFAULT_RESOLVER_POLICY,
  )
  return inspector.inspect([recoveryCallId])
}

describe("Achieve QA recovery adapter", () => {
  it("uses a canonical transcript ledger event when the QA table has no transcript", async () => {
    const callId = AchieveQaRecoveryCallIdSchema.parse("approved-gap-01")
    const inspector = createSupabaseAchieveQaRecoveryInspector(
      createEnv(),
      async () => ({
        calls: {
          data: [{
            call_id: callId,
            disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
            talk_time: 301,
            campaign_name: null,
            sfdc_lead_id: "lead-01",
            started_at: "2026-08-12T00:00:00Z",
          }],
          error: null,
        },
        transcripts: { data: [], error: null },
        events: {
          data: [{
            regal_task_id: callId,
            event_type: "transcript_available",
            payload: {
              event_type: "transcript_available",
              regal_task_id: callId,
              transcript: "canonical private transcript",
            },
          }],
          error: null,
        },
        results: { data: [], error: null },
      }),
      async () => DEFAULT_RESOLVER_POLICY,
    )

    const inspected = await inspector.inspect([callId])

    expect(inspected).toMatchObject({
      _tag: "success",
      candidates: [{
        callId,
        existingResult: false,
        input: { transcript: { transcript: "canonical private transcript" } },
      }],
    })
  })

  it("prefers a valid QA-table transcript over the ledger event", async () => {
    const callId = AchieveQaRecoveryCallIdSchema.parse("approved-gap-01")
    const inspector = createSupabaseAchieveQaRecoveryInspector(
      createEnv(),
      async () => ({
        calls: {
          data: [{
            call_id: callId,
            disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
            talk_time: 301,
            campaign_name: null,
            sfdc_lead_id: "lead-01",
            started_at: "2026-08-12T00:00:00Z",
          }],
          error: null,
        },
        transcripts: {
          data: [{
            call_id: callId,
            original_transcript: "preferred QA transcript",
            created_at: "2026-08-12T01:00:00Z",
          }],
          error: null,
        },
        events: {
          data: [{
            regal_task_id: callId,
            event_type: "transcript_available",
            payload: {
              event_type: "transcript_available",
              regal_task_id: callId,
              transcript: "ledger transcript must not win",
            },
          }],
          error: null,
        },
        results: { data: [], error: null },
      }),
      async () => DEFAULT_RESOLVER_POLICY,
    )

    const inspected = await inspector.inspect([callId])

    expect(inspected).toMatchObject({
      _tag: "success",
      candidates: [{
        input: { transcript: { transcript: "preferred QA transcript" } },
      }],
    })
  })

  it("fails closed when the only ledger payload is malformed", async () => {
    const inspected = await inspectRecoveryRows({
      events: [{
        regal_task_id: recoveryCallId,
        event_type: "transcript_available",
        payload: {
          regal_task_id: recoveryCallId,
          transcript: "private transcript without canonical event type",
        },
      }],
    })

    expect(inspected).toMatchObject({
      _tag: "success",
      candidates: [{
        callId: recoveryCallId,
        input: null,
        inputStatus: "invalid_input",
      }],
    })
  })

  it.each([
    {
      condition: "marked truncated",
      payload: {
        event_type: "transcript_available",
        regal_task_id: recoveryCallId,
        transcript: "incomplete private transcript",
        transcript_is_truncated: true,
      },
    },
    {
      condition: "blank",
      payload: {
        event_type: "transcript_available",
        regal_task_id: recoveryCallId,
        transcript: "   ",
      },
    },
    {
      condition: "over the 200,000-character canonical limit",
      payload: {
        event_type: "transcript_available",
        regal_task_id: recoveryCallId,
        transcript: "x".repeat(200_001),
      },
    },
  ])("fails closed when a ledger transcript is $condition", async ({ payload }) => {
    const inspected = await inspectRecoveryRows({
      events: [{
        regal_task_id: recoveryCallId,
        event_type: "transcript_available",
        payload,
      }],
    })

    expect(inspected).toMatchObject({
      _tag: "success",
      candidates: [{
        callId: recoveryCallId,
        input: null,
        inputStatus: "invalid_input",
      }],
    })
  })

  it("fails closed when ledger rows contain conflicting transcripts", async () => {
    const inspected = await inspectRecoveryRows({
      events: ["first", "second"].map((transcript) => ({
        regal_task_id: recoveryCallId,
        event_type: "transcript_available",
        payload: {
          event_type: "transcript_available",
          regal_task_id: recoveryCallId,
          transcript,
        },
      })),
    })

    expect(inspected).toMatchObject({
      _tag: "success",
      candidates: [{
        callId: recoveryCallId,
        input: null,
        inputStatus: "invalid_input",
      }],
    })
  })

  it("rejects a ledger row outside the requested cohort", async () => {
    const outOfCohortCallId = AchieveQaRecoveryCallIdSchema.parse("not-requested")
    const inspected = await inspectRecoveryRows({
      events: [{
        regal_task_id: outOfCohortCallId,
        event_type: "transcript_available",
        payload: {
          event_type: "transcript_available",
          regal_task_id: outOfCohortCallId,
          transcript: "private transcript",
        },
      }],
    })

    expect(inspected).toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("rejects a non-transcript ledger row even if its payload looks usable", async () => {
    const inspected = await inspectRecoveryRows({
      events: [{
        regal_task_id: recoveryCallId,
        event_type: "call_completed",
        payload: {
          event_type: "transcript_available",
          regal_task_id: recoveryCallId,
          transcript: "private transcript",
        },
      }],
    })

    expect(inspected).toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("classifies the production UNIQUE(call_id,module_name) race without updating or attaching metadata", async () => {
    const inserts: Array<unknown> = []
    const finalize = createAchieveQaRecoveryInsertOnlyFinalizer(async (record) => {
      inserts.push(record)
      return { error: { code: "23505" } }
    })
    const callId = AchieveQaRecoveryCallIdSchema.parse("approved-gap-01")

    const result = await finalize(callId, {
      module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      result: { partner_id: "achieve", script_version: "ordinary" },
      has_violation: false,
      violation_type: null,
      processing_time_ms: 10,
    })

    expect(result).toEqual({ _tag: "already_exists" })
    expect(inserts).toEqual([{
      call_id: callId,
      module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      result_json: { partner_id: "achieve", script_version: "ordinary" },
      has_violation: false,
      violation_type: null,
      alert_sent: false,
      alert_sent_at: null,
      processing_time_ms: 10,
    }])
    expect(inserts[0]).not.toHaveProperty("agent_email")
    expect(inserts[0]).not.toHaveProperty("contact_name")
    expect(inserts[0]).not.toHaveProperty("contact_phone")
    expect(inserts[0]).not.toHaveProperty("recording_link")
  })

  it("fails closed deterministically when newest transcript rows tie without a stable unique tie-break field", async () => {
    const callId = AchieveQaRecoveryCallIdSchema.parse("approved-gap-01")
    const call = {
      call_id: callId,
      disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
      talk_time: 301,
      campaign_name: null,
      sfdc_lead_id: "lead-01",
      started_at: "2026-08-12T00:00:00Z",
    }
    const tiedTranscripts = [
      { call_id: callId, original_transcript: "first private transcript", created_at: "2026-08-12T01:00:00Z" },
      { call_id: callId, original_transcript: "second private transcript", created_at: "2026-08-12T01:00:00Z" },
    ]

    const inspect = async (transcripts: ReadonlyArray<(typeof tiedTranscripts)[number]>) => {
      const inspector = createSupabaseAchieveQaRecoveryInspector(
        createEnv(),
        async () => ({
          calls: { data: [call], error: null },
          transcripts: { data: transcripts, error: null },
          events: { data: [], error: null },
          results: { data: [], error: null },
        }),
        async () => DEFAULT_RESOLVER_POLICY,
      )
      return inspector.inspect([callId])
    }

    const forward = await inspect(tiedTranscripts)
    const reversed = await inspect([...tiedTranscripts].reverse())

    expect(forward).toEqual(reversed)
    expect(forward).toMatchObject({
      _tag: "success",
      candidates: [{
        callId,
        existingResult: false,
        input: null,
        inputStatus: "invalid_input",
      }],
    })
  })
})
