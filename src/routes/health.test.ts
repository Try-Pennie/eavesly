import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"

const mockHealthCheck = vi.fn()

vi.mock("../services/database", () => ({
  DatabaseService: class {
    healthCheck = mockHealthCheck
  },
}))

import { healthRoutes } from "./health"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"

function createApp() {
  const app = new Hono<AppEnv>()
  app.route("/", healthRoutes)
  return app
}

describe("health routes", () => {
  beforeEach(() => {
    mockHealthCheck.mockReset()
  })

  describe("GET /", () => {
    it("returns service info", async () => {
      const app = createApp()
      const res = await app.request("/", {}, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.service).toBe("eavesly")
      expect(body.version).toBe("2.0.0")
      expect(body.status).toBe("ok")
    })
  })

  describe("GET /health", () => {
    it("returns healthy when database is connected", async () => {
      mockHealthCheck.mockResolvedValue(true)
      const app = createApp()
      const res = await app.request("/health", {}, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe("healthy")
      expect((body.checks as any).database).toBe("connected")
    })

    it("returns degraded when database is disconnected", async () => {
      mockHealthCheck.mockResolvedValue(false)
      const app = createApp()
      const res = await app.request("/health", {}, createEnv())
      expect(res.status).toBe(503)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe("degraded")
      expect((body.checks as any).database).toBe("disconnected")
    })

    it("includes environment in response", async () => {
      mockHealthCheck.mockResolvedValue(true)
      const app = createApp()
      const res = await app.request("/health", {}, createEnv({ ENVIRONMENT: "production" }))
      const body = (await res.json()) as Record<string, unknown>
      expect(body.environment).toBe("production")
    })

    it("includes version in response", async () => {
      mockHealthCheck.mockResolvedValue(true)
      const app = createApp()
      const res = await app.request("/health", {}, createEnv())
      const body = (await res.json()) as Record<string, unknown>
      expect(body.version).toBe("2.0.0")
    })
  })
})
