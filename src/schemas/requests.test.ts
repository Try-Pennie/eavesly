import { describe, it, expect } from "vitest"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
  BackfillEvaluateRequestSchema,
  BackfillNextRequestSchema,
  EvaluateFromRecordingRequestSchema,
} from "./requests"

const validRequest = {
  call_id: "call-123",
  agent_id: "agent-456",
  transcript: {
    transcript: "Hello, this is a test transcript.",
    metadata: {
      duration: 300,
      timestamp: "2025-01-01T00:00:00Z",
    },
  },
}

describe("EvaluateRequestSchema", () => {
  it("valid single request passes", () => {
    const result = EvaluateRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  it("missing call_id fails", () => {
    const { call_id, ...rest } = validRequest
    const result = EvaluateRequestSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it("transcript exceeding max length fails", () => {
    const longTranscript = {
      ...validRequest,
      transcript: {
        ...validRequest.transcript,
        transcript: "x".repeat(200001),
      },
    }
    const result = EvaluateRequestSchema.safeParse(longTranscript)
    expect(result.success).toBe(false)
  })

  it("transcript at max length passes", () => {
    const maxTranscript = {
      ...validRequest,
      transcript: {
        ...validRequest.transcript,
        transcript: "x".repeat(200000),
      },
    }
    const result = EvaluateRequestSchema.safeParse(maxTranscript)
    expect(result.success).toBe(true)
  })
})

describe("BatchEvaluateRequestSchema", () => {
  it("defaults ordinary batches to live execution", () => {
    const result = BatchEvaluateRequestSchema.safeParse({
      calls: [validRequest],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.execution).toEqual({ mode: "live" })
    }
  })

  it("accepts an auditable backfill execution mode", () => {
    const result = BatchEvaluateRequestSchema.safeParse({
      calls: [validRequest],
      execution: { mode: "backfill", run_id: "regal-outage-2026-07" },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.execution).toEqual({
        mode: "backfill",
        run_id: "regal-outage-2026-07",
      })
    }
  })

  it("rejects a backfill batch without a run id", () => {
    const result = BatchEvaluateRequestSchema.safeParse({
      calls: [validRequest],
      execution: { mode: "backfill" },
    })
    expect(result.success).toBe(false)
  })

  it("batch with >10 items fails", () => {
    const calls = Array.from({ length: 11 }, (_, i) => ({
      ...validRequest,
      call_id: `call-${i}`,
    }))
    const result = BatchEvaluateRequestSchema.safeParse({ calls })
    expect(result.success).toBe(false)
  })

  it("empty batch fails", () => {
    const result = BatchEvaluateRequestSchema.safeParse({ calls: [] })
    expect(result.success).toBe(false)
  })

  it("batch at max size passes", () => {
    const calls = Array.from({ length: 10 }, (_, i) => ({
      ...validRequest,
      call_id: `call-${i}`,
    }))
    const result = BatchEvaluateRequestSchema.safeParse({ calls })
    expect(result.success).toBe(true)
  })
})

describe("BackfillEvaluateRequestSchema", () => {
  it("accepts up to ten call IDs with an auditable run ID", () => {
    const result = BackfillEvaluateRequestSchema.safeParse({
      call_ids: ["call-1", "call-2"],
      run_id: "regal-outage-2026-07-smoke-1",
    })

    expect(result.success).toBe(true)
  })
})

describe("BackfillNextRequestSchema", () => {
  it("accepts a checkpoint cursor and an enrollment filter", () => {
    const result = BackfillNextRequestSchema.safeParse({
      start: "2026-07-26T10:04:00Z",
      end: "2026-07-26T10:10:00Z",
      after_call_id: "WT123",
      filter: "enrollment",
      run_id: "regal-outage-2026-07-full-1",
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(10)
  })
})

describe("EvaluateRequestSchema optional Regal fields", () => {
  it("passes without optional fields", () => {
    const result = EvaluateRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  it("passes with all optional fields", () => {
    const result = EvaluateRequestSchema.safeParse({
      ...validRequest,
      agent_email: "agent@example.com",
      contact_name: "John Doe",
      contact_phone: "+15551234567",
      recording_link: "https://recordings.example.com/call-123",
      call_summary: "Test call summary",
      transcript_url: "https://transcripts.example.com/call-123",
      sfdc_lead_id: "00Q1234567890AB",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_email).toBe("agent@example.com")
      expect(result.data.contact_name).toBe("John Doe")
      expect(result.data.contact_phone).toBe("+15551234567")
      expect(result.data.recording_link).toBe("https://recordings.example.com/call-123")
      expect(result.data.call_summary).toBe("Test call summary")
      expect(result.data.transcript_url).toBe("https://transcripts.example.com/call-123")
      expect(result.data.sfdc_lead_id).toBe("00Q1234567890AB")
    }
  })

  it("passes with a subset of optional fields", () => {
    const result = EvaluateRequestSchema.safeParse({
      ...validRequest,
      agent_email: "agent@example.com",
      recording_link: "https://recordings.example.com/call-123",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_email).toBe("agent@example.com")
      expect(result.data.contact_name).toBeUndefined()
    }
  })
})

describe("EvaluateFromRecordingRequestSchema", () => {
  const valid = {
    call_id: "rec-1",
    agent_id: "agent-1",
    recording_url: "https://api.twilio.com/REC123",
    metadata: { timestamp: "2025-01-01T00:00:00Z" },
  }

  it("accepts a minimal valid body and defaults recording_source", () => {
    const parsed = EvaluateFromRecordingRequestSchema.parse(valid)
    expect(parsed.recording_source).toBe("twilio")
    expect(parsed.metadata.duration).toBeUndefined()
  })

  it("rejects a body missing recording_url", () => {
    const { recording_url, ...rest } = valid
    expect(EvaluateFromRecordingRequestSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects a non-URL recording_url", () => {
    expect(EvaluateFromRecordingRequestSchema.safeParse({ ...valid, recording_url: "not-a-url" }).success).toBe(false)
  })
})
