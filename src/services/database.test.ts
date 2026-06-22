import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"

const mockUpsert = vi.fn()
const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

import { DatabaseService } from "./database"

describe("DatabaseService", () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockInsert.mockReset()
    mockSelect.mockReset()
    mockFrom.mockReset()
    mockFrom.mockImplementation(() => ({
      upsert: mockUpsert,
      insert: mockInsert,
      select: mockSelect,
    }))
    mockUpsert.mockResolvedValue({ error: null })
    mockInsert.mockResolvedValue({ error: null })
    mockSelect.mockReturnValue({
      limit: vi.fn().mockResolvedValue({ error: null }),
    })
  })

  describe("storeModuleResult()", () => {
    it("upserts to eavesly_module_results table", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: { test: true },
        has_violation: false,
        violation_type: null,
        processing_time_ms: 100,
      }, false)

      expect(mockFrom).toHaveBeenCalledWith("eavesly_module_results")
    })

    it("includes correct fields in upsert", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: { test: true },
        has_violation: true,
        violation_type: "manager_escalation",
        processing_time_ms: 200,
      }, true)

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          call_id: "call-1",
          module_name: "full_qa",
          result_json: { test: true },
          has_violation: true,
          violation_type: "manager_escalation",
          alert_sent: true,
          processing_time_ms: 200,
        }),
        { onConflict: "call_id,module_name" },
      )
    })

    it("stores Regal context fields when callData provided", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: {},
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }, false, {
        call_id: "call-1",
        agent_id: "agent-1",
        transcript: { transcript: "test", metadata: { duration: 100, timestamp: "2025-01-01T00:00:00Z" } },
        agent_email: "agent@example.com",
        contact_name: "John Doe",
        contact_phone: "+15551234567",
        recording_link: "https://recordings.example.com/call-1",
        call_summary: "Test summary",
        transcript_url: "https://transcripts.example.com/call-1",
        sfdc_lead_id: "00Q1234567890AB",
      })

      const call = mockUpsert.mock.calls[0][0]
      expect(call.agent_email).toBe("agent@example.com")
      expect(call.contact_name).toBe("John Doe")
      expect(call.contact_phone).toBe("+15551234567")
      expect(call.recording_link).toBe("https://recordings.example.com/call-1")
      expect(call.call_summary).toBe("Test summary")
      expect(call.transcript_url).toBe("https://transcripts.example.com/call-1")
      expect(call.sfdc_lead_id).toBe("00Q1234567890AB")
    })

    it("stores null for Regal fields when callData not provided", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: {},
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }, false)

      const call = mockUpsert.mock.calls[0][0]
      expect(call.agent_email).toBeNull()
      expect(call.contact_name).toBeNull()
      expect(call.contact_phone).toBeNull()
      expect(call.recording_link).toBeNull()
      expect(call.call_summary).toBeNull()
      expect(call.transcript_url).toBeNull()
      expect(call.sfdc_lead_id).toBeNull()
    })

    it("sets alert_sent_at when alert sent", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: {},
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }, true)

      const call = mockUpsert.mock.calls[0][0]
      expect(call.alert_sent_at).toBeTruthy()
    })

    it("sets alert_sent_at to null when no alert", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeModuleResult("call-1", {
        module_name: "full_qa",
        result: {},
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }, false)

      const call = mockUpsert.mock.calls[0][0]
      expect(call.alert_sent_at).toBeNull()
    })

    it("throws on upsert error", async () => {
      mockUpsert.mockResolvedValue({ error: { message: "DB write failed" } })
      const db = new DatabaseService(createEnv())
      await expect(
        db.storeModuleResult("call-1", {
          module_name: "full_qa",
          result: {},
          has_violation: false,
          violation_type: null,
          processing_time_ms: 50,
        }, false),
      ).rejects.toEqual({ message: "DB write failed" })
    })
  })

  describe("storeQAResult()", () => {
    const mockCallData = {
      call_id: "call-1",
      agent_id: "agent-1",
      agent_email: "agent@test.com",
      sfdc_lead_id: "lead-1",
      transcript_url: "https://example.com/transcript",
      recording_link: "https://example.com/recording",
      transcript: { transcript: "hello world", metadata: { duration: 60, timestamp: "2026-01-01" } },
    }

    const mockQaResult = {
      overall_call_rating: { overall_score: "good", compliance_rating: "pass", customer_satisfaction_likely: "high" },
      call_overview: { manager_review_required: false, call_outcome: "Call went well" },
    }

    it("upserts to eavesly_transcription_qa table", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeQAResult(mockCallData, mockQaResult, "manager@test.com")

      expect(mockFrom).toHaveBeenCalledWith("eavesly_transcription_qa")
    })

    it("includes correct fields", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeQAResult(mockCallData, mockQaResult, "manager@test.com")

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          call_id: "call-1",
          agent_email: "agent@test.com",
          sfdc_lead_id: "lead-1",
          overall_score: "good",
          compliance_rating: "pass",
          customer_satisfaction_likely: "high",
          manager_escalation: false,
          call_summary: "Call went well",
          qa_json: mockQaResult,
          original_transcript: "hello world",
          transcription_link: "https://example.com/transcript",
          recording_link: "https://example.com/recording",
          manager_email: "manager@test.com",
        }),
      )
    })

    it("does not throw on error (non-fatal)", async () => {
      mockInsert.mockResolvedValue({ error: { message: "Legacy table error" } })
      const db = new DatabaseService(createEnv())
      // Should not throw
      await db.storeQAResult(mockCallData, {}, "")
    })
  })

  describe("getSalesFloorRows()", () => {
    function windowChain(data: unknown[] | null, error: unknown = null) {
      const range = vi.fn().mockResolvedValue({ data, error })
      const order = vi.fn().mockReturnValue({ range })
      const lt = vi.fn().mockReturnValue({ order })
      const gte = vi.fn().mockReturnValue({ lt })
      const select = vi.fn().mockReturnValue({ gte })
      return { select, range }
    }

    it("fetches only aggregate-safe columns and omits raw customer data", async () => {
      const calls = windowChain([], null)
      const qa = windowChain([], null)
      const modules = windowChain([], null)
      mockFrom
        .mockReturnValueOnce({ select: calls.select })
        .mockReturnValueOnce({ select: qa.select })
        .mockReturnValueOnce({ select: modules.select })

      const db = new DatabaseService(createEnv())
      await db.getSalesFloorRows("2026-06-01T00:00:00.000Z", "2026-06-08T00:00:00.000Z")

      expect(mockFrom).toHaveBeenNthCalledWith(1, "eavesly_calls")
      expect(calls.select).toHaveBeenCalledWith("started_at, agent_email, talk_time, disposition")
      expect(qa.select).toHaveBeenCalledWith("created_at, agent_email, manager_email, overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation")
      expect(modules.select).toHaveBeenCalledWith("created_at, module_name, has_violation, agent_email")
    })

    it("fails loudly instead of returning false-zero report data on query errors", async () => {
      const calls = windowChain(null, { message: "missing column" })
      const qa = windowChain([], null)
      const modules = windowChain([], null)
      mockFrom
        .mockReturnValueOnce({ select: calls.select })
        .mockReturnValueOnce({ select: qa.select })
        .mockReturnValueOnce({ select: modules.select })

      const db = new DatabaseService(createEnv())
      await expect(db.getSalesFloorRows("2026-06-01T00:00:00.000Z", "2026-06-08T00:00:00.000Z")).rejects.toThrow(
        "Failed to fetch sales-floor rows from eavesly_calls",
      )
    })
  })

  describe("healthCheck()", () => {
    it("returns true when database is reachable", async () => {
      const db = new DatabaseService(createEnv())
      const result = await db.healthCheck()
      expect(result).toBe(true)
    })

    it("returns false when database has error", async () => {
      mockSelect.mockReturnValue({
        limit: vi.fn().mockResolvedValue({ error: { message: "Connection failed" } }),
      })
      const db = new DatabaseService(createEnv())
      const result = await db.healthCheck()
      expect(result).toBe(false)
    })

    it("queries eavesly_module_results for health check", async () => {
      const db = new DatabaseService(createEnv())
      await db.healthCheck()
      expect(mockFrom).toHaveBeenCalledWith("eavesly_module_results")
    })
  })

  describe("getCallContext()", () => {
    function mockCallRow(row: unknown, error: unknown = null) {
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
          }),
        }),
      })
    }

    it("looks up eavesly_calls and returns disposition + sfdc_lead_id", async () => {
      mockCallRow({ disposition: "Not Interested", sfdc_lead_id: "00Q123" })
      const db = new DatabaseService(createEnv())
      const ctx = await db.getCallContext("call-1")
      expect(mockFrom).toHaveBeenCalledWith("eavesly_calls")
      expect(ctx).toEqual({ disposition: "Not Interested", sfdc_lead_id: "00Q123" })
    })

    it("returns null when the call is not found", async () => {
      mockCallRow(null)
      const db = new DatabaseService(createEnv())
      expect(await db.getCallContext("missing")).toBeNull()
    })

    it("returns null (does not throw) on query error", async () => {
      mockCallRow(null, { message: "boom" })
      const db = new DatabaseService(createEnv())
      expect(await db.getCallContext("call-1")).toBeNull()
    })
  })

  describe("getActiveDispositions()", () => {
    function mockDispositions(data: unknown, error: unknown = null) {
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error }),
        }),
      })
    }

    it("queries eavesly_dispositions for active rows and maps them", async () => {
      mockDispositions([
        {
          name: "1.2 - Interested > No Call Scheduled",
          description: "Lead interested.",
          visibility: "All Users",
          conversation_happened: "yes",
          ai_only: false,
        },
      ])
      const db = new DatabaseService(createEnv())
      const result = await db.getActiveDispositions()

      expect(mockFrom).toHaveBeenCalledWith("eavesly_dispositions")
      expect(result).toEqual([
        {
          name: "1.2 - Interested > No Call Scheduled",
          description: "Lead interested.",
          visibility: "All Users",
          conversation_happened: "yes",
          ai_only: false,
        },
      ])
    })

    it("returns an empty array (does not throw) on query error", async () => {
      mockDispositions(null, { message: "boom" })
      const db = new DatabaseService(createEnv())
      expect(await db.getActiveDispositions()).toEqual([])
    })
  })
})
