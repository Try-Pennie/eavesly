import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { DatabaseService } from "../services/database"

const healthRoutes = new Hono<AppEnv>()

healthRoutes.get("/", (c) => {
  return c.json({
    service: "eavesly",
    version: "2.0.0",
    status: "ok",
  })
})

healthRoutes.get("/health", async (c) => {
  const db = new DatabaseService(c.env)
  const dbHealthy = await db.healthCheck()

  const status = dbHealthy ? "healthy" : "degraded"
  const statusCode = dbHealthy ? 200 : 503

  return c.json(
    {
      status,
      version: "2.0.0",
      environment: c.env.ENVIRONMENT,
      checks: {
        database: dbHealthy ? "connected" : "disconnected",
      },
    },
    statusCode,
  )
})

export { healthRoutes }
