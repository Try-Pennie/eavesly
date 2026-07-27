import { describe, expect, it } from "vitest"
import {
  evaluateEventPairingHealth,
  evaluateIngestionHealth,
  evaluatePipelineHealth,
  parseMonitoringSnapshot,
  type MonitoringSnapshot,
} from "./monitoring-health"

function snapshot(overrides: Partial<MonitoringSnapshot> = {}): MonitoringSnapshot {
  return {
    observedAt: new Date("2026-07-27T12:20:00Z"),
    latestCallCompletedAt: new Date("2026-07-27T12:15:00Z"),
    latestTranscriptAvailableAt: new Date("2026-07-27T12:14:00Z"),
    eventsMissingPlan: 0,
    completedEventsMissingCallProjection: 0,
    completedEventsSampled: 100,
    completedEventsMissingTranscript: 0,
    transcriptEventsSampled: 100,
    transcriptEventsMissingCompletion: 0,
    launchedPlansMissingResults: 0,
    ...overrides,
  }
}

describe("Eavesly ingestion health", () => {
  it("reports healthy when both event streams are fresh during active hours", () => {
    expect(evaluateIngestionHealth(snapshot())).toEqual({
      status: "healthy",
      schedule: "active",
      checks: {
        call_completed: { status: "fresh", age_seconds: 300 },
        transcript_available: { status: "fresh", age_seconds: 360 },
      },
    })
  })

  it("reports the stale stream during active hours", () => {
    expect(evaluateIngestionHealth(snapshot({
      latestTranscriptAvailableAt: new Date("2026-07-27T11:30:00Z"),
    }))).toMatchObject({
      status: "degraded",
      schedule: "active",
      checks: {
        call_completed: { status: "fresh" },
        transcript_available: { status: "stale", age_seconds: 3_000 },
      },
    })
  })

  it("does not false-alert during the first fifteen minutes of the active window", () => {
    expect(evaluateIngestionHealth(snapshot({
      observedAt: new Date("2026-07-27T12:10:00Z"),
      latestCallCompletedAt: new Date("2026-07-25T23:00:00Z"),
      latestTranscriptAvailableAt: new Date("2026-07-25T23:00:00Z"),
    }))).toMatchObject({ status: "healthy", schedule: "not_scheduled" })
  })

  it("does not enforce event freshness on Sundays", () => {
    expect(evaluateIngestionHealth(snapshot({
      observedAt: new Date("2026-07-26T16:00:00Z"),
      latestCallCompletedAt: new Date("2026-07-25T23:00:00Z"),
      latestTranscriptAvailableAt: new Date("2026-07-25T23:00:00Z"),
    }))).toMatchObject({ status: "healthy", schedule: "not_scheduled" })
  })
})

describe("Eavesly event pairing health", () => {
  it("keeps normal source-event gap rates healthy", () => {
    expect(evaluateEventPairingHealth(snapshot({
      completedEventsMissingTranscript: 50,
      transcriptEventsMissingCompletion: 10,
    }))).toEqual({
      status: "healthy",
      policy: {
        window_minutes: 120,
        grace_minutes: 15,
        minimum_sample_size: 25,
      },
      checks: {
        completed_without_transcript: {
          status: "healthy",
          affected: 50,
          sampled: 100,
          rate_percent: 50,
          threshold_percent: 60,
        },
        transcript_without_completion: {
          status: "healthy",
          affected: 10,
          sampled: 100,
          rate_percent: 10,
          threshold_percent: 15,
        },
      },
    })
  })

  it("degrades when either source-event gap rate exceeds policy", () => {
    expect(evaluateEventPairingHealth(snapshot({
      completedEventsMissingTranscript: 61,
      transcriptEventsMissingCompletion: 16,
    }))).toMatchObject({
      status: "degraded",
      checks: {
        completed_without_transcript: { status: "degraded", rate_percent: 61 },
        transcript_without_completion: { status: "degraded", rate_percent: 16 },
      },
    })
  })

  it("uses the unrounded rate at the alert boundary", () => {
    expect(evaluateEventPairingHealth(snapshot({
      completedEventsSampled: 10_000,
      completedEventsMissingTranscript: 6_001,
    }))).toMatchObject({
      status: "degraded",
      checks: {
        completed_without_transcript: { status: "degraded", rate_percent: 60 },
      },
    })
  })

  it("does not alert on a low-volume pairing sample", () => {
    expect(evaluateEventPairingHealth(snapshot({
      completedEventsSampled: 20,
      completedEventsMissingTranscript: 20,
      transcriptEventsSampled: 0,
      transcriptEventsMissingCompletion: 0,
    }))).toMatchObject({
      status: "healthy",
      checks: {
        completed_without_transcript: { status: "insufficient_data", rate_percent: 100 },
        transcript_without_completion: { status: "insufficient_data", rate_percent: null },
      },
    })
  })
})

describe("Eavesly pipeline health", () => {
  it("identifies every degraded pipeline stage without exposing records", () => {
    expect(evaluatePipelineHealth(snapshot({
      eventsMissingPlan: 2,
      completedEventsMissingCallProjection: 1,
      launchedPlansMissingResults: 3,
    }))).toEqual({
      status: "degraded",
      checks: {
        resolver_plans: { status: "degraded", affected: 2 },
        call_projection: { status: "degraded", affected: 1 },
        module_results: { status: "degraded", affected: 3 },
      },
    })
  })
})

describe("monitoring snapshot parsing", () => {
  it("parses the Supabase RPC row into the monitoring domain", () => {
    expect(parseMonitoringSnapshot({
      observed_at: "2026-07-27T12:20:00+00:00",
      latest_call_completed_at: "2026-07-27T12:15:00+00:00",
      latest_transcript_available_at: null,
      events_missing_plan: 0,
      completed_events_missing_call_projection: "1",
      completed_events_sampled: 100,
      completed_events_missing_transcript: 3,
      transcript_events_sampled: 100,
      transcript_events_missing_completion: "4",
      launched_plans_missing_results: 2,
    })).toEqual(snapshot({
      latestTranscriptAvailableAt: null,
      completedEventsMissingCallProjection: 1,
      completedEventsMissingTranscript: 3,
      transcriptEventsMissingCompletion: 4,
      launchedPlansMissingResults: 2,
    }))
  })

  it("rejects malformed persisted snapshots", () => {
    expect(() => parseMonitoringSnapshot({ observed_at: "not-a-date" })).toThrow("monitoring snapshot")
  })

  it("fails closed instead of coercing null counts to zero", () => {
    expect(() => parseMonitoringSnapshot({
      observed_at: "2026-07-27T12:20:00+00:00",
      latest_call_completed_at: null,
      latest_transcript_available_at: null,
      events_missing_plan: null,
      completed_events_missing_call_projection: 0,
      completed_events_sampled: 0,
      completed_events_missing_transcript: 0,
      transcript_events_sampled: 0,
      transcript_events_missing_completion: 0,
      launched_plans_missing_results: 0,
    })).toThrow("monitoring snapshot")
  })

  it("rejects pairing counts that exceed their sample", () => {
    expect(() => parseMonitoringSnapshot({
      observed_at: "2026-07-27T12:20:00+00:00",
      latest_call_completed_at: null,
      latest_transcript_available_at: null,
      events_missing_plan: 0,
      completed_events_missing_call_projection: 0,
      completed_events_sampled: 0,
      completed_events_missing_transcript: 1,
      transcript_events_sampled: 0,
      transcript_events_missing_completion: 0,
      launched_plans_missing_results: 0,
    })).toThrow("monitoring snapshot")
  })
})
