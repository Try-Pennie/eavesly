import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"

const mockUpsert = vi.fn()
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
    mockSelect.mockReset()
    mockFrom.mockReset()
    mockFrom.mockImplementation(() => ({
      upsert: mockUpsert,
      select: mockSelect,
    }))
    mockUpsert.mockResolvedValue({ error: null })
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
    it("upserts to eavesly_transcription_qa table", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeQAResult("call-1", { qa: "data" }, 150)

      expect(mockFrom).toHaveBeenCalledWith("eavesly_transcription_qa")
    })

    it("includes correct fields", async () => {
      const db = new DatabaseService(createEnv())
      await db.storeQAResult("call-1", { qa: "data" }, 150)

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          call_id: "call-1",
          qa_result: { qa: "data" },
          processing_time_ms: 150,
        }),
        { onConflict: "call_id" },
      )
    })

    it("does not throw on error (non-fatal)", async () => {
      mockUpsert.mockResolvedValue({ error: { message: "Legacy table error" } })
      const db = new DatabaseService(createEnv())
      // Should not throw
      await db.storeQAResult("call-1", {}, 50)
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
})
