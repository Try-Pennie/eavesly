import { Hono } from "hono"
import type { AppEnv, Bindings } from "../types/env"
import { DatabaseService } from "../services/database"
import {
  evaluateEventPairingHealth,
  evaluateIngestionHealth,
  evaluatePipelineHealth,
  type MonitoringSnapshot,
} from "../services/monitoring-health"
import { log } from "../utils/logger"

const VERSION = "2.0.0"

export interface HealthDatabase {
  readonly healthCheck: () => Promise<boolean>
  readonly getMonitoringSnapshot: () => Promise<MonitoringSnapshot>
}

export type CreateHealthDatabase = (env: Bindings) => HealthDatabase

function statusCode(status: "healthy" | "degraded"): 200 | 503 {
  return status === "healthy" ? 200 : 503
}

/** Creates public, PII-free operational health routes with an injectable database boundary. */
export function createHealthRoutes(
  createDatabase: CreateHealthDatabase = (env) => new DatabaseService(env),
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.use("*", async (c, next) => {
    c.header("cache-control", "no-store")
    await next()
  })

  routes.get("/", (c) => {
    return c.json({ service: "eavesly", version: VERSION, status: "ok" })
  })

  routes.get("/health", async (c) => {
    const dbHealthy = await createDatabase(c.env).healthCheck()
    const status = dbHealthy ? "healthy" : "degraded"
    return c.json({
      status,
      version: VERSION,
      environment: c.env.ENVIRONMENT,
      checks: { database: dbHealthy ? "connected" : "disconnected" },
    }, statusCode(status))
  })

  routes.get("/health/ingestion", async (c) => {
    try {
      const snapshot = await createDatabase(c.env).getMonitoringSnapshot()
      const health = evaluateIngestionHealth(snapshot)
      return c.json({
        status: health.status,
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        schedule: health.schedule,
        checks: health.checks,
      }, statusCode(health.status))
    } catch {
      log("error", "Ingestion health snapshot unavailable", {
        correlationId: c.get("correlationId"),
        operation: "ingestion_health",
        error: "snapshot_unavailable",
      })
      return c.json({
        status: "degraded",
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        checks: { monitoring: "unavailable" },
      }, 503)
    }
  })

  routes.get("/health/event-pairing", async (c) => {
    try {
      const snapshot = await createDatabase(c.env).getMonitoringSnapshot()
      const health = evaluateEventPairingHealth(snapshot)
      return c.json({
        status: health.status,
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        policy: health.policy,
        checks: health.checks,
      }, statusCode(health.status))
    } catch {
      log("error", "Event-pairing health snapshot unavailable", {
        correlationId: c.get("correlationId"),
        operation: "event_pairing_health",
        error: "snapshot_unavailable",
      })
      return c.json({
        status: "degraded",
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        checks: { monitoring: "unavailable" },
      }, 503)
    }
  })

  routes.get("/health/pipeline", async (c) => {
    try {
      const snapshot = await createDatabase(c.env).getMonitoringSnapshot()
      const health = evaluatePipelineHealth(snapshot)
      return c.json({
        status: health.status,
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        checks: health.checks,
      }, statusCode(health.status))
    } catch {
      log("error", "Pipeline health snapshot unavailable", {
        correlationId: c.get("correlationId"),
        operation: "pipeline_health",
        error: "snapshot_unavailable",
      })
      return c.json({
        status: "degraded",
        version: VERSION,
        environment: c.env.ENVIRONMENT,
        checks: { monitoring: "unavailable" },
      }, 503)
    }
  })

  return routes
}

export const healthRoutes = createHealthRoutes()
