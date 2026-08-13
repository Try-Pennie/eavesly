import { describe, expect, it } from "vitest"
import { MODULE_NAMES } from "../modules/constants"
import { AchieveQaRecoveryCallIdSchema } from "../schemas/achieve-qa-recovery"
import { createEnv } from "../../test/helpers/mock-env"
import { DEFAULT_RESOLVER_POLICY } from "./regal-events"
import {
  createAchieveQaRecoveryInsertOnlyFinalizer,
  createSupabaseAchieveQaRecoveryInspector,
} from "./achieve-qa-recovery-adapter"

describe("Achieve QA recovery insert-only finalizer", () => {
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
