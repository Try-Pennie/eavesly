import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createEnv } from "../../test/helpers/mock-env"
import { DatabaseService } from "./database"

class CandidateSourceClient {
  from(table: string) {
    if (table === "eavesly_transcription_qa") {
      const terminal = async () => ({
        data: [
          { call_id: "call-1" },
          { call_id: "call-2" },
          { call_id: "call-3" },
        ],
        error: null,
      })
      const ordered = {
        gt: () => ({ limit: terminal }),
        limit: terminal,
      }
      return {
        select: () => ({
          gte: () => ({
            lt: () => ({
              not: () => ({
                order: () => ordered,
              }),
            }),
          }),
        }),
      }
    }

    if (table === "eavesly_calls") {
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              gt: async () => ({ data: [{ call_id: "call-3" }], error: null }),
            }),
          }),
        }),
      }
    }

    if (table === "eavesly_module_results") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [{ call_id: "call-2" }], error: null }),
          }),
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  }
}

describe("DatabaseService.getBackfillCandidatePage()", () => {
  it("returns only calls still missing the requested module and advances the cursor", async () => {
    const client = new CandidateSourceClient()
    const db = new DatabaseService(createEnv(), client as unknown as SupabaseClient)

    const result = await db.getBackfillCandidatePage({
      start: "2026-07-26T10:04:00Z",
      end: "2026-07-26T10:10:00Z",
      moduleName: "full_qa",
      filter: "all",
      limit: 10,
    })

    expect(result).toEqual({
      call_ids: ["call-1", "call-3"],
      next_cursor: "call-3",
      scanned: 3,
    })
  })

  it("applies the enrollment policy before returning missing calls", async () => {
    const client = new CandidateSourceClient()
    const db = new DatabaseService(createEnv(), client as unknown as SupabaseClient)

    const result = await db.getBackfillCandidatePage({
      start: "2026-07-26T10:04:00Z",
      end: "2026-07-26T10:10:00Z",
      moduleName: "program_expectations",
      filter: "enrollment",
      enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
      enrollmentMinDurationSeconds: 1200,
      limit: 10,
    })

    expect(result.call_ids).toEqual(["call-3"])
  })
})
