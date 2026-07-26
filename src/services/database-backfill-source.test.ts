import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createEnv } from "../../test/helpers/mock-env"
import { DatabaseService } from "./database"

class BackfillSourceClient {
  from(table: string) {
    if (table === "eavesly_calls") {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: {
                  call_id: "call-1",
                  agent_email: "agent@test.com",
                  sfdc_lead_id: "lead-1",
                  contact_phone: "+15551234567",
                  disposition: "1.2 - Interested",
                  campaign_name: "Campaign A",
                  talk_time: 321,
                  started_at: "2026-07-25T14:28:00Z",
                  completed_at: "2026-07-25T14:34:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
      }
    }

    if (table === "eavesly_transcription_qa") {
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      created_at: "2026-07-26T10:04:00Z",
                      original_transcript: "[Agent]: Hello\n[Customer]: Hi",
                      agent_email: "transcript-agent@test.com",
                      sfdc_lead_id: null,
                      call_summary: "Source summary",
                      recording_link: null,
                      transcription_link: "https://example.com/transcript",
                      qa_json: { regal_recording_link: "https://example.com/recording" },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  }
}

describe("DatabaseService.getBackfillCallData()", () => {
  it("rebuilds an evaluation request from the restored call and source transcript rows", async () => {
    const client = new BackfillSourceClient()
    const db = new DatabaseService(createEnv(), client as unknown as SupabaseClient)

    const result = await db.getBackfillCallData("call-1")

    expect(result).toEqual({
      call_id: "call-1",
      regal_task_id: "call-1",
      agent_id: "transcript-agent@test.com",
      transcript: {
        transcript: "[Agent]: Hello\n[Customer]: Hi",
        metadata: {
          duration: 321,
          timestamp: "2026-07-25T14:28:00Z",
          talk_time: 321,
          disposition: "1.2 - Interested",
          campaign_name: "Campaign A",
        },
      },
      agent_email: "transcript-agent@test.com",
      contact_phone: "+15551234567",
      recording_link: "https://example.com/recording",
      call_summary: "Source summary",
      transcript_url: "https://example.com/transcript",
      sfdc_lead_id: "lead-1",
    })
  })
})
