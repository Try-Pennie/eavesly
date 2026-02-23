import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { statusRoutes } from "./status"

function createApp() {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", statusRoutes)
  return app
}

describe("status routes", () => {
  describe("GET /status/:instanceId", () => {
    it("returns 401 without auth", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/status/test-instance", {}, createEnv())
      expect(res.status).toBe(401)
    })

    it("returns workflow status for valid instance", async () => {
      const mockStatus = vi.fn().mockResolvedValue({
        status: "complete",
        output: { call_id: "test-123", has_violation: false },
      })
      const mockGet = vi.fn().mockResolvedValue({ status: mockStatus })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: vi.fn(), get: mockGet } as any,
      })

      const app = createApp()
      const res = await app.request("/api/v1/status/test-instance", {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }, env)

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.instanceId).toBe("test-instance")
      expect(body.status).toBe("complete")
      expect(body.output.call_id).toBe("test-123")
      expect(mockGet).toHaveBeenCalledWith("test-instance")
    })

    it("returns running status for in-progress workflow", async () => {
      const mockStatus = vi.fn().mockResolvedValue({ status: "running" })
      const mockGet = vi.fn().mockResolvedValue({ status: mockStatus })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: vi.fn(), get: mockGet } as any,
      })

      const app = createApp()
      const res = await app.request("/api/v1/status/running-instance", {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }, env)

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.instanceId).toBe("running-instance")
      expect(body.status).toBe("running")
    })
  })
})
