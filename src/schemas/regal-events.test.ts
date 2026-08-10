import { describe, it, expect } from "vitest"
import {
  TranscriptAvailableEventSchema,
  CallCompletedEventSchema,
} from "./regal-events"

describe("TranscriptAvailableEventSchema", () => {
  const valid = {
    event_type: "transcript_available",
    regal_task_id: "task-123",
    agent_email: "agent@example.com",
    transcript: "Hello there.",
    recording_duration: "1500",
    recording_link: "https://example.com/rec.mp3",
    transcript_is_truncated: "false",
    customProperties: { LegalState: "No", collectionsBalance: "2.5" },
  }

  it("parses a valid payload and coerces numbers", () => {
    const r = TranscriptAvailableEventSchema.parse(valid)
    expect(r.recording_duration).toBe(1500)
    expect(r.transcript_is_truncated).toBe(false)
    expect(r.customProperties?.collectionsBalance).toBe(2.5)
    expect(r.customProperties?.LegalState).toBe("No")
  })

  it("rejects wrong event_type", () => {
    expect(TranscriptAvailableEventSchema.safeParse({ ...valid, event_type: "call_completed" }).success).toBe(false)
  })

  it("requires regal_task_id", () => {
    const { regal_task_id, ...rest } = valid
    expect(TranscriptAvailableEventSchema.safeParse(rest).success).toBe(false)
  })

  it("keeps unknown customProperties via passthrough and allows opaque raw_event", () => {
    const r = TranscriptAvailableEventSchema.parse({
      event_type: "transcript_available",
      regal_task_id: "t1",
      customProperties: { LegalState: "No", extra: "keep-me" },
      raw_event: { anything: [1, 2, 3] },
    })
    expect((r.customProperties as any).extra).toBe("keep-me")
    expect(r.raw_event).toEqual({ anything: [1, 2, 3] })
  })
})

describe("CallCompletedEventSchema", () => {
  const valid = {
    event_type: "call_completed",
    regal_task_id: "task-123",
    disposition: "1.4 - Converted/Won > END CAMPAIGNS",
    campaign_name: "Q3 Outbound",
    campaign_friendly_id: "445",
    recording_duration: "1800",
    conversation_happened: "true",
    talk_time: "1200",
    wrapup_time: "6",
    handle_time: "1206",
    started_at: 1657855046,
    ended_at: 1657855053,
    completed_at: 1657855059,
  }

  it("parses a valid payload and coerces numbers", () => {
    const r = CallCompletedEventSchema.parse(valid)
    expect(r.recording_duration).toBe(1800)
    expect(r.conversation_happened).toBe(true)
    expect(r.talk_time).toBe(1200)
    expect(r.wrapup_time).toBe(6)
    expect(r.handle_time).toBe(1206)
    expect(r.completed_at).toBe(1657855059)
    expect(r.disposition).toBe("1.4 - Converted/Won > END CAMPAIGNS")
  })

  it("rejects wrong event_type", () => {
    expect(CallCompletedEventSchema.safeParse({ ...valid, event_type: "transcript_available" }).success).toBe(false)
  })

  it("allows a minimal payload (only event_type + regal_task_id)", () => {
    expect(CallCompletedEventSchema.safeParse({ event_type: "call_completed", regal_task_id: "t" }).success).toBe(true)
  })
})
