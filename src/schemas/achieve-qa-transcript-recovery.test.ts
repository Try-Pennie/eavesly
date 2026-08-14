import { describe, expect, it } from "vitest"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH,
  AchieveQaTranscriptRecoveryRequestSchema,
} from "./achieve-qa-transcript-recovery"

const events = Array.from({ length: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT }, (_, index) => ({
  event_type: "transcript_available" as const,
  regal_task_id: `achieve-gap-${String(index + 1).padStart(2, "0")}`,
  transcript: `canonical transcript ${index + 1}`,
  transcript_is_truncated: false as const,
}))

describe("Achieve QA transcript recovery request", () => {
  it("accepts exactly 12 strict canonical source events up to the recovery cap", () => {
    const parsed = AchieveQaTranscriptRecoveryRequestSchema.parse({
      events: events.map((event, index) => index === 0
        ? { ...event, transcript: "x".repeat(ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH) }
        : event),
    })

    expect(parsed.dry_run).toBe(true)
    expect(parsed.events).toHaveLength(12)
  })

  it.each([
    ["too few events", { events: events.slice(0, 11) }],
    ["duplicate IDs", { events: [...events.slice(0, 11), events[0]] }],
    ["blank transcript", { events: events.map((event, index) => index === 0 ? { ...event, transcript: "  " } : event) }],
    ["truncated transcript", { events: events.map((event, index) => index === 0 ? { ...event, transcript_is_truncated: true } : event) }],
    ["oversized transcript", { events: events.map((event, index) => index === 0 ? { ...event, transcript: "x".repeat(262_145) } : event) }],
    ["unknown field", { events, extra: true }],
  ])("rejects %s", (_name, value) => {
    expect(AchieveQaTranscriptRecoveryRequestSchema.safeParse(value).success).toBe(false)
  })

  it("requires a digest only for execution", () => {
    expect(AchieveQaTranscriptRecoveryRequestSchema.safeParse({
      events,
      dry_run: false,
    }).success).toBe(false)
    expect(AchieveQaTranscriptRecoveryRequestSchema.safeParse({
      events,
      digest: {
        algorithm: "SHA-256",
        canonicalization: "achieve-qa-transcript-recovery-v1",
        value: "a".repeat(64),
      },
    }).success).toBe(false)
  })
})
