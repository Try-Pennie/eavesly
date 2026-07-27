import { describe, expect, it } from "vitest"
import {
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
    triggeredPlansMissingResults: 0,
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

describe("Eavesly pipeline health", () => {
  it("identifies every degraded pipeline stage without exposing records", () => {
    expect(evaluatePipelineHealth(snapshot({
      eventsMissingPlan: 2,
      completedEventsMissingCallProjection: 1,
      triggeredPlansMissingResults: 3,
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
      triggered_plans_missing_results: 2,
    })).toEqual(snapshot({
      latestTranscriptAvailableAt: null,
      completedEventsMissingCallProjection: 1,
      triggeredPlansMissingResults: 2,
    }))
  })

  it("rejects malformed persisted snapshots", () => {
    expect(() => parseMonitoringSnapshot({ observed_at: "not-a-date" })).toThrow("monitoring snapshot")
  })
})
