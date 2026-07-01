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

  describe("recordRegalCallEvent()", () => {
    it("upserts to eavesly_regal_call_events on (regal_task_id,event_type)", async () => {
      const db = new DatabaseService(createEnv())
      await db.recordRegalCallEvent({
        event_type: "transcript_available",
        regal_task_id: "task-1",
        agent_email: "a@b.com",
        source_event_id: "evt-1",
      } as any)

      expect(mockFrom).toHaveBeenCalledWith("eavesly_regal_call_events")
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          regal_task_id: "task-1",
          event_type: "transcript_available",
          agent_email: "a@b.com",
          source_event_id: "evt-1",
        }),
        { onConflict: "regal_task_id,event_type" },
      )
    })

    it("throws on upsert error", async () => {
      mockUpsert.mockResolvedValue({ error: { message: "boom" } })
      const db = new DatabaseService(createEnv())
      await expect(
        db.recordRegalCallEvent({ event_type: "call_completed", regal_task_id: "t" } as any),
      ).rejects.toEqual({ message: "boom" })
    })
  })

  describe("getRegalCallEvents()", () => {
    function mockRows(rows: unknown, error: unknown = null) {
      mockSelect.mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: rows, error }) })
    }

    it("splits rows into transcript/completed by event_type", async () => {
      mockRows([
        { event_type: "transcript_available", payload: { regal_task_id: "t", transcript: "hi" } },
        { event_type: "call_completed", payload: { regal_task_id: "t", disposition: "x" } },
      ])
      const db = new DatabaseService(createEnv())
      const joined = await db.getRegalCallEvents("t")
      expect(mockFrom).toHaveBeenCalledWith("eavesly_regal_call_events")
      expect(joined.transcript).toEqual({ regal_task_id: "t", transcript: "hi" })
      expect(joined.completed).toEqual({ regal_task_id: "t", disposition: "x" })
    })

    it("returns {} (does not throw) on error", async () => {
      mockRows(null, { message: "boom" })
      const db = new DatabaseService(createEnv())
      expect(await db.getRegalCallEvents("t")).toEqual({})
    })
  })

  describe("recordRegalResolverPlan()", () => {
    it("upserts to eavesly_regal_resolver_plans on regal_task_id", async () => {
      const db = new DatabaseService(createEnv())
      await db.recordRegalResolverPlan({
        regal_task_id: "task-1",
        enrolled: true,
        decisions: [],
        triggered: ["full_qa"],
      })
      expect(mockFrom).toHaveBeenCalledWith("eavesly_regal_resolver_plans")
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ regal_task_id: "task-1", enrolled: true, triggered_modules: ["full_qa"] }),
        { onConflict: "regal_task_id" },
      )
    })

    it("does not throw on error (best-effort shadow write)", async () => {
      mockUpsert.mockResolvedValue({ error: { message: "boom" } })
      const db = new DatabaseService(createEnv())
      await db.recordRegalResolverPlan({ regal_task_id: "t", enrolled: false, decisions: [], triggered: [] })
    })
  })

  describe("getBackfillCandidates()", () => {
    // transcripts defaults to `null` meaning "every queried id has a transcript",
    // so tests that don't care about transcript filtering behave as before.
    function mockTables(
      plans: any[] | null,
      planErr: unknown,
      results: unknown,
      resErr: unknown = null,
      transcripts: string[] | null = null,
    ) {
      mockFrom.mockImplementation((table: string) => {
        if (table === "eavesly_regal_resolver_plans") {
          return { select: () => ({ gte: () => ({ lt: () => Promise.resolve({ data: plans, error: planErr }) }) }) }
        }
        if (table === "eavesly_module_results") {
          return { select: () => ({ in: () => Promise.resolve({ data: results, error: resErr }) }) }
        }
        if (table === "eavesly_regal_call_events") {
          const ids = transcripts ?? (plans ?? []).map((p) => p.regal_task_id)
          const rows = ids.map((regal_task_id) => ({ regal_task_id }))
          return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }) }) }
        }
        return {}
      })
    }

    it("returns only triggered modules missing a result", async () => {
      mockTables(
        [
          { regal_task_id: "task-1", triggered_modules: ["full_qa", "litigation_check"] },
          { regal_task_id: "task-2", triggered_modules: ["full_qa"] },
          { regal_task_id: "task-3", triggered_modules: [] },
        ],
        null,
        [{ call_id: "task-1", module_name: "full_qa" }], // task-1 has full_qa, missing litigation_check
      )
      const db = new DatabaseService(createEnv())
      const candidates = await db.getBackfillCandidates("2026-07-01T20:08:00Z", "2026-07-01T20:49:51Z")
      expect(candidates).toEqual([
        { regal_task_id: "task-1", triggered_modules: ["full_qa", "litigation_check"], missing_modules: ["litigation_check"] },
        { regal_task_id: "task-2", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
      ])
    })

    it("excludes candidates with no transcript_available event", async () => {
      mockTables(
        [
          { regal_task_id: "task-1", triggered_modules: ["full_qa"] },
          { regal_task_id: "task-2", triggered_modules: ["full_qa"] },
        ],
        null,
        [],
        null,
        ["task-2"], // only task-2 has a transcript event
      )
      const db = new DatabaseService(createEnv())
      const candidates = await db.getBackfillCandidates("a", "b")
      expect(candidates).toEqual([
        { regal_task_id: "task-2", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
      ])
    })

    it("orders candidates deterministically by computed_at then regal_task_id", async () => {
      mockTables(
        [
          { regal_task_id: "task-b", triggered_modules: ["full_qa"], computed_at: "2026-07-01T20:30:00Z" },
          { regal_task_id: "task-a", triggered_modules: ["full_qa"], computed_at: "2026-07-01T20:10:00Z" },
          { regal_task_id: "task-c", triggered_modules: ["full_qa"], computed_at: "2026-07-01T20:10:00Z" },
        ],
        null,
        [],
      )
      const db = new DatabaseService(createEnv())
      const candidates = await db.getBackfillCandidates("a", "b")
      expect(candidates.map((c) => c.regal_task_id)).toEqual(["task-a", "task-c", "task-b"])
    })

    it("returns [] when no plans have triggered modules", async () => {
      mockTables([{ regal_task_id: "t", triggered_modules: [] }], null, [])
      const db = new DatabaseService(createEnv())
      expect(await db.getBackfillCandidates("a", "b")).toEqual([])
    })

    it("throws on resolver plan query error", async () => {
      mockTables(null, { message: "boom" }, [])
      const db = new DatabaseService(createEnv())
      await expect(db.getBackfillCandidates("a", "b")).rejects.toEqual({ message: "boom" })
    })
  })

  describe("getDuplicateAudit()", () => {
    function mockDupTables(mr: unknown, ce: unknown, rp: unknown) {
      mockFrom.mockImplementation((table: string) => {
        const data =
          table === "eavesly_module_results" ? mr : table === "eavesly_regal_call_events" ? ce : rp
        return { select: () => ({ in: () => Promise.resolve({ data, error: null }) }) }
      })
    }

    it("returns 0 counts for empty id list without querying", async () => {
      const db = new DatabaseService(createEnv())
      expect(await db.getDuplicateAudit([])).toEqual({
        duplicate_module_results: 0,
        duplicate_call_events: 0,
        duplicate_resolver_plans: 0,
      })
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it("counts rows beyond the first per key", async () => {
      mockDupTables(
        [
          { call_id: "t1", module_name: "full_qa" },
          { call_id: "t1", module_name: "full_qa" }, // dup
          { call_id: "t1", module_name: "litigation_check" },
        ],
        [
          { regal_task_id: "t1", event_type: "call_completed" },
          { regal_task_id: "t1", event_type: "call_completed" }, // dup
        ],
        [{ regal_task_id: "t1" }],
      )
      const db = new DatabaseService(createEnv())
      expect(await db.getDuplicateAudit(["t1"])).toEqual({
        duplicate_module_results: 1,
        duplicate_call_events: 1,
        duplicate_resolver_plans: 0,
      })
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

    it("looks up eavesly_calls and returns disposition + sfdc_lead_id + agent_email + talk_time", async () => {
      mockCallRow({ disposition: "Not Interested", sfdc_lead_id: "00Q123", agent_email: "agent_pennie-mgmt_10@regal.ai", talk_time: 0 })
      const db = new DatabaseService(createEnv())
      const ctx = await db.getCallContext("call-1")
      expect(mockFrom).toHaveBeenCalledWith("eavesly_calls")
      expect(ctx).toEqual({ disposition: "Not Interested", sfdc_lead_id: "00Q123", agent_email: "agent_pennie-mgmt_10@regal.ai", talk_time: 0 })
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

  describe("getAgentRegalAssignment()", () => {
    function mockAssignmentRow(row: unknown, error: unknown = null) {
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
          }),
        }),
      })
    }

    it("looks up agent_regal_assignments and returns partner_assignment + assignment_status", async () => {
      mockAssignmentRow({ partner_assignment: "achieve", assignment_status: "resolved" })
      const db = new DatabaseService(createEnv())
      const result = await db.getAgentRegalAssignment("agent@achieve.com")
      expect(mockFrom).toHaveBeenCalledWith("agent_regal_assignments")
      expect(result).toEqual({ partner_assignment: "achieve", assignment_status: "resolved" })
    })

    it("returns null when the agent is not found", async () => {
      mockAssignmentRow(null)
      const db = new DatabaseService(createEnv())
      expect(await db.getAgentRegalAssignment("missing@example.com")).toBeNull()
    })

    it("returns null (does not throw) on query error", async () => {
      mockAssignmentRow(null, { message: "boom" })
      const db = new DatabaseService(createEnv())
      expect(await db.getAgentRegalAssignment("agent@achieve.com")).toBeNull()
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
