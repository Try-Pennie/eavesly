import { describe, expect, it } from "vitest"
import { MODULE_NAMES } from "../modules/constants"
import { AchieveQaRecoveryCallIdSchema } from "../schemas/achieve-qa-recovery"
import { createAchieveQaRecoveryInsertOnlyFinalizer } from "./achieve-qa-recovery-adapter"

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
})
