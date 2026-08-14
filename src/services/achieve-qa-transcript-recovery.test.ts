import { describe, expect, it } from "vitest"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  AchieveQaTranscriptRecoverySourceEventSchema,
} from "../schemas/achieve-qa-transcript-recovery"
import {
  inspectAchieveQaTranscriptRecovery,
  type AchieveQaTranscriptRecoveryLedger,
} from "./achieve-qa-transcript-recovery"

const events = Array.from(
  { length: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT },
  (_, index) => AchieveQaTranscriptRecoverySourceEventSchema.parse({
    event_type: "transcript_available",
    regal_task_id: `achieve-gap-${String(index + 1).padStart(2, "0")}`,
    transcript: `private source ${index + 1}`,
    transcript_is_truncated: false,
    source_event_id: `snowflake-event-${index + 1}`,
  }),
)

const absentLedger: AchieveQaTranscriptRecoveryLedger = {
  async inspect() { return { _tag: "success", state: "absent" } },
  async restore() { throw new Error("not used") },
}

describe("Achieve QA transcript recovery snapshot", () => {
  it("is order-independent but changes when any private source changes", async () => {
    const ascending = await inspectAchieveQaTranscriptRecovery(absentLedger, events)
    const descending = await inspectAchieveQaTranscriptRecovery(absentLedger, [...events].reverse())
    const changed = await inspectAchieveQaTranscriptRecovery(absentLedger, events.map(
      (event, index) => index === 0 ? { ...event, transcript: `${event.transcript} changed` } : event,
    ))
    if ("_tag" in ascending || "_tag" in descending || "_tag" in changed) {
      throw new Error("fixture inspection failed")
    }

    expect(descending.digest).toEqual(ascending.digest)
    expect(changed.digest.value).not.toBe(ascending.digest.value)
    expect(ascending).toEqual({
      summary: {
        candidate_count: 12,
        ready_insert_count: 12,
        already_restored_count: 0,
      },
      digest: {
        algorithm: "SHA-256",
        canonicalization: "achieve-qa-transcript-recovery-v1",
        value: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
  })
})
