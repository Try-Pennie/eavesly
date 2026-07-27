import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { createEnv } from "../../test/helpers/mock-env"
import type { AppEnv } from "../types/env"
import type { MonitoringSnapshot } from "../services/monitoring-health"
import { createHealthRoutes, type HealthDatabase } from "./health"

function healthySnapshot(overrides: Partial<MonitoringSnapshot> = {}): MonitoringSnapshot {
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

class FakeHealthDatabase implements HealthDatabase {
  constructor(
    private readonly databaseHealthy: boolean,
    private readonly snapshot: MonitoringSnapshot | Error = healthySnapshot(),
  ) {}

  async healthCheck(): Promise<boolean> {
    return this.databaseHealthy
  }

  async getMonitoringSnapshot(): Promise<MonitoringSnapshot> {
    if (this.snapshot instanceof Error) throw this.snapshot
    return this.snapshot
  }
}

function createApp(database: HealthDatabase = new FakeHealthDatabase(true)) {
  const app = new Hono<AppEnv>()
  app.route("/", createHealthRoutes(() => database))
  return app
}

describe("health routes", () => {
  it("returns service info", async () => {
    const res = await createApp().request("/", {}, createEnv())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ service: "eavesly", version: "2.0.0", status: "ok" })
  })

  it("reports database connectivity", async () => {
    const healthy = await createApp(new FakeHealthDatabase(true)).request("/health", {}, createEnv())
    const degraded = await createApp(new FakeHealthDatabase(false)).request("/health", {}, createEnv())

    expect(healthy.status).toBe(200)
    expect(await healthy.json()).toMatchObject({ status: "healthy", checks: { database: "connected" } })
    expect(degraded.status).toBe(503)
    expect(await degraded.json()).toMatchObject({ status: "degraded", checks: { database: "disconnected" } })
  })

  it("reports fresh Regal ingestion without exposing event records", async () => {
    const res = await createApp().request("/health/ingestion", {}, createEnv({ ENVIRONMENT: "production" }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: "healthy",
      version: "2.0.0",
      environment: "production",
      schedule: "active",
      checks: {
        call_completed: { status: "fresh", age_seconds: 300 },
        transcript_available: { status: "fresh", age_seconds: 360 },
      },
    })
  })

  it("returns 503 when one Regal event stream is stale", async () => {
    const database = new FakeHealthDatabase(true, healthySnapshot({
      latestTranscriptAvailableAt: new Date("2026-07-27T11:30:00Z"),
    }))
    const res = await createApp(database).request("/health/ingestion", {}, createEnv())

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      status: "degraded",
      checks: { transcript_available: { status: "stale" } },
    })
  })

  it("returns 503 with aggregate pipeline failures", async () => {
    const database = new FakeHealthDatabase(true, healthySnapshot({ triggeredPlansMissingResults: 2 }))
    const res = await createApp(database).request("/health/pipeline", {}, createEnv())

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      status: "degraded",
      checks: { module_results: { status: "degraded", affected: 2 } },
    })
  })

  it("fails closed without leaking database errors when monitoring is unavailable", async () => {
    const database = new FakeHealthDatabase(true, new Error("sensitive database detail"))
    const res = await createApp(database).request("/health/ingestion", {}, createEnv())

    expect(res.status).toBe(503)
    const raw = await res.text()
    expect(JSON.parse(raw)).toEqual({
      status: "degraded",
      version: "2.0.0",
      environment: "test",
      checks: { monitoring: "unavailable" },
    })
    expect(raw).not.toContain("sensitive")
  })
})
