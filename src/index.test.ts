import { describe, it, expect, vi } from "vitest"
import { createEnv, TEST_API_KEY } from "../test/helpers/mock-env"
import excellentFixture from "../test/fixtures/responses/full-qa-excellent.json"
import violationFixture from "../test/fixtures/responses/full-qa-violation.json"
import budgetPassFixture from "../test/fixtures/responses/budget-inputs-pass.json"
import warmTransferFixture from "../test/fixtures/responses/warm-transfer-no-violation.json"

const mockGetStructuredResponse = vi.fn()

vi.mock("./services/llm-client", () => ({
  createLLMClient: () => ({
    getStructuredResponse: mockGetStructuredResponse,
  }),
}))

vi.mock("./services/database", () => ({
  DatabaseService: class {
    storeModuleResult = vi.fn().mockResolvedValue(undefined)
    storeQAResult = vi.fn().mockResolvedValue(undefined)
    healthCheck = vi.fn().mockResolvedValue(true)
  },
}))

vi.mock("./services/alerts", () => ({
  dispatchAlerts: vi.fn(),
}))

import app from "./index"

const validBody = {
  call_id: "e2e-call-123",
  agent_id: "agent-456",
  transcript: {
    transcript: "Hello, this is a test transcript for E2E.",
    metadata: { duration: 300, timestamp: "2025-01-01T00:00:00Z" },
  },
}

describe("E2E app tests", () => {
  describe("health endpoints", () => {
    it("GET / returns service info without auth", async () => {
      const res = await app.request("/", {}, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.service).toBe("eavesly")
    })

    it("GET /health returns healthy without auth", async () => {
      const res = await app.request("/health", {}, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.status).toBe("healthy")
    })
  })

  describe("auth enforcement", () => {
    it("rejects unauthenticated full-qa request", async () => {
      const res = await app.request("/api/v1/evaluate/full-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(401)
    })

    it("rejects unauthenticated budget-inputs request", async () => {
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(401)
    })

    it("rejects unauthenticated warm-transfer request", async () => {
      const res = await app.request("/api/v1/evaluate/warm-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(401)
    })
  })

  describe("CORS headers", () => {
    it("includes CORS headers on responses", async () => {
      const res = await app.request("/", {}, createEnv())
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    })

    it("handles OPTIONS preflight", async () => {
      const res = await app.request("/api/v1/evaluate/full-qa", {
        method: "OPTIONS",
      }, createEnv())
      expect(res.status).toBe(204)
    })
  })

  describe("correlation IDs", () => {
    it("generates correlation ID on responses", async () => {
      const res = await app.request("/", {}, createEnv())
      expect(res.headers.get("X-Correlation-ID")).toBeTruthy()
    })

    it("uses provided correlation ID", async () => {
      const res = await app.request("/", {
        headers: { "X-Correlation-ID": "my-id-123" },
      }, createEnv())
      expect(res.headers.get("X-Correlation-ID")).toBe("my-id-123")
    })
  })

  describe("full-qa happy path", () => {
    it("processes excellent call successfully", async () => {
      mockGetStructuredResponse.mockResolvedValue(excellentFixture)
      const res = await app.request("/api/v1/evaluate/full-qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.has_violation).toBe(false)
      expect(body.module).toBe("full_qa")
    })

    it("processes violation call successfully", async () => {
      mockGetStructuredResponse.mockResolvedValue(violationFixture)
      const mockExecCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const res = await app.request("/api/v1/evaluate/full-qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnv(), mockExecCtx)
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.has_violation).toBe(true)
      expect(body.violation_type).toBe("manager_escalation")
    })
  })

  describe("budget-inputs happy path", () => {
    it("processes budget inputs call successfully", async () => {
      mockGetStructuredResponse.mockResolvedValue(budgetPassFixture)
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
      expect(body.has_violation).toBe(false)
    })
  })

  describe("warm-transfer happy path", () => {
    it("processes warm transfer call successfully", async () => {
      mockGetStructuredResponse.mockResolvedValue(warmTransferFixture)
      const res = await app.request("/api/v1/evaluate/warm-transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.module).toBe("warm_transfer")
      expect(body.has_violation).toBe(false)
    })
  })
})
