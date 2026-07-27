import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createEnv } from "../../test/helpers/mock-env"
import { DatabaseService } from "./database"

class RecordingRpcClient {
  readonly calls: string[] = []

  constructor(private readonly response: { data: unknown; error: { message: string } | null }) {}

  async rpc(name: string): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push(name)
    return this.response
  }
}

function database(client: RecordingRpcClient): DatabaseService {
  // SAFETY: this recording fake implements the only Supabase operation exercised by this focused boundary test.
  return new DatabaseService(createEnv(), client as unknown as SupabaseClient)
}

describe("DatabaseService monitoring snapshot", () => {
  it("loads and parses the PII-free monitoring RPC row", async () => {
    const client = new RecordingRpcClient({
      data: [{
        observed_at: "2026-07-27T12:20:00+00:00",
        latest_call_completed_at: "2026-07-27T12:15:00+00:00",
        latest_transcript_available_at: "2026-07-27T12:14:00+00:00",
        events_missing_plan: 0,
        completed_events_missing_call_projection: 0,
        completed_events_sampled: 100,
        completed_events_missing_transcript: 0,
        transcript_events_sampled: 50,
        transcript_events_missing_completion: 0,
        launched_plans_missing_results: 0,
      }],
      error: null,
    })

    const result = await database(client).getMonitoringSnapshot()

    expect(client.calls).toEqual(["eavesly_monitoring_snapshot_v2"])
    expect(result).toMatchObject({
      observedAt: new Date("2026-07-27T12:20:00Z"),
      eventsMissingPlan: 0,
      completedEventsMissingCallProjection: 0,
      completedEventsSampled: 100,
      completedEventsMissingTranscript: 0,
      transcriptEventsSampled: 50,
      transcriptEventsMissingCompletion: 0,
      launchedPlansMissingResults: 0,
    })
  })

  it("fails safely when the monitoring RPC is unavailable", async () => {
    const client = new RecordingRpcClient({ data: null, error: { message: "database detail" } })

    await expect(database(client).getMonitoringSnapshot()).rejects.toThrow("monitoring snapshot unavailable")
  })
})
