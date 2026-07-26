import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createEnv } from "../../test/helpers/mock-env"
import { DatabaseService } from "./database"

class RecordingQaClient {
  selectedCallId: string | undefined
  updatePayload: Record<string, unknown> | undefined
  updatedRowId: number | undefined

  constructor(private readonly sourceRow: { id: number } | null = { id: 42 }) {}

  from(table: string) {
    if (table !== "eavesly_transcription_qa") {
      throw new Error(`Unexpected table: ${table}`)
    }

    return {
      select: () => ({
        eq: (_field: string, callId: string) => {
          this.selectedCallId = callId
          return {
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: this.sourceRow, error: null }),
                }),
              }),
            }),
          }
        },
      }),
      update: (payload: Record<string, unknown>) => {
        this.updatePayload = payload
        return {
          eq: async (_field: string, rowId: number) => {
            this.updatedRowId = rowId
            return { error: null }
          },
        }
      },
    }
  }
}

const callData = {
  call_id: "call-1",
  agent_id: "agent-1",
  agent_email: "agent@test.com",
  sfdc_lead_id: "lead-1",
  transcript_url: "https://example.com/transcript",
  recording_link: "https://example.com/recording",
  transcript: {
    transcript: "source transcript that must remain on the existing row",
    metadata: { duration: 60, timestamp: "2026-01-01" },
  },
}

const qaResult = {
  overall_call_rating: {
    overall_score: "good",
    compliance_rating: "pass",
    customer_satisfaction_likely: "high",
  },
  call_overview: {
    manager_review_required: false,
    call_outcome: "Call went well",
  },
}

describe("DatabaseService.updateExistingQAResult()", () => {
  it("enriches the existing transcript row instead of inserting another row", async () => {
    const client = new RecordingQaClient()
    const db = new DatabaseService(createEnv(), client as unknown as SupabaseClient)

    await db.updateExistingQAResult(callData, qaResult, "manager@test.com")

    expect(client.selectedCallId).toBe("call-1")
    expect(client.updatedRowId).toBe(42)
    expect(client.updatePayload).toEqual({
      agent_email: "agent@test.com",
      sfdc_lead_id: "lead-1",
      overall_score: "good",
      compliance_rating: "pass",
      customer_satisfaction_likely: "high",
      manager_escalation: false,
      call_summary: "Call went well",
      qa_json: qaResult,
      transcription_link: "https://example.com/transcript",
      recording_link: "https://example.com/recording",
      manager_email: "manager@test.com",
    })
  })

  it("fails visibly when Phase A did not create a transcript row", async () => {
    const client = new RecordingQaClient(null)
    const db = new DatabaseService(createEnv(), client as unknown as SupabaseClient)

    await expect(
      db.updateExistingQAResult(callData, qaResult, "manager@test.com"),
    ).rejects.toThrow("No legacy transcript row found for backfill call call-1")
    expect(client.updatePayload).toBeUndefined()
  })
})
