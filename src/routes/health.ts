import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { DatabaseService } from "../services/database"

const app = new Hono<AppEnv>()

app.get("/", (c) => {
  return c.json({
    service: "eavesly",
    version: "2.0.0",
    status: "ok",
  })
})

app.get("/health", async (c) => {
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

export { app as healthRoutes }
