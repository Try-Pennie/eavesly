import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import passFixture from "../../test/fixtures/responses/budget-inputs-pass.json"

const mockGetStructuredResponse = vi.fn().mockResolvedValue(passFixture)

vi.mock("../services/llm-client", () => ({
  createLLMClient: () => ({
    getStructuredResponse: mockGetStructuredResponse,
  }),
}))

vi.mock("../services/database", () => ({
  DatabaseService: class {
    storeModuleResult = vi.fn().mockResolvedValue(undefined)
    storeQAResult = vi.fn().mockResolvedValue(undefined)
  },
}))

vi.mock("../services/alerts", () => ({
  dispatchAlerts: vi.fn(),
}))

import { budgetInputsRoutes } from "./budget-inputs"

function createApp() {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", budgetInputsRoutes)
  return app
}

const validBody = {
  call_id: "test-call-123",
  agent_id: "agent-456",
  transcript: {
    transcript: "Hello, this is a test transcript.",
    metadata: { duration: 300, timestamp: "2025-01-01T00:00:00Z" },
  },
}

describe("budget-inputs routes", () => {
  beforeEach(() => {
    mockGetStructuredResponse.mockClear()
    mockGetStructuredResponse.mockResolvedValue(passFixture)
  })

  describe("POST /evaluate/budget-inputs", () => {
    it("returns 401 without auth", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(401)
    })

    it("returns 400 with invalid body", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({}),
      }, createEnv())
      expect(res.status).toBe(400)
    })

    it("returns 200 with valid request", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.module).toBe("budget_inputs")
    })
  })

  describe("POST /evaluate/budget-inputs/batch", () => {
    it("returns 200 with valid batch", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ calls: [validBody] }),
      }, createEnv())
      expect(res.status).toBe(200)
    })

    it("returns 400 with more than 10 calls", async () => {
      const calls = Array.from({ length: 11 }, (_, i) => ({
        ...validBody,
        call_id: `call-${i}`,
      }))
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ calls }),
      }, createEnv())
      expect(res.status).toBe(400)
    })

    it("returns 400 with empty batch", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ calls: [] }),
      }, createEnv())
      expect(res.status).toBe(400)
    })
  })
})
