import { describe, it, expect, vi } from "vitest"
import { createEnv, TEST_API_KEY } from "../test/helpers/mock-env"
import excellentFixture from "../test/fixtures/responses/full-qa-excellent.json"
import violationFixture from "../test/fixtures/responses/full-qa-violation.json"
import warmTransferFixture from "../test/fixtures/responses/warm-transfer-no-violation.json"

const { mockGetStructuredResponse, mockDispatchAlerts, mockStoreModuleResult } = vi.hoisted(() => ({
  mockGetStructuredResponse: vi.fn(),
  mockDispatchAlerts: vi.fn(),
  mockStoreModuleResult: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./services/llm-client", () => ({
  createLLMClient: () => ({
    getStructuredResponse: mockGetStructuredResponse,
  }),
}))

vi.mock("./services/database", () => ({
  DatabaseService: class {
    storeModuleResult = mockStoreModuleResult
    storeQAResult = vi.fn().mockResolvedValue(undefined)
    healthCheck = vi.fn().mockResolvedValue(true)
    logRequest = vi.fn().mockResolvedValue(undefined)
  },
}))

vi.mock("./services/alerts", () => ({
  dispatchAlerts: mockDispatchAlerts,
  processAlert: vi.fn(),
}))

import app from "./index"

const validBody = {
  call_id: "e2e-call-123",
  agent_id: "agent-456",
  agent_email: "agent@example.com",
  contact_name: "John Doe",
  contact_phone: "+15551234567",
  recording_link: "https://recordings.example.com/e2e-call-123",
  call_summary: "Test call summary",
  transcript_url: "https://transcripts.example.com/e2e-call-123",
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

  describe("budget-inputs workflow dispatch", () => {
    it("returns 202 with workflow_instance_id", async () => {
      const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-instance-123" })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
      })
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, env)
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe("budget_inputs")
      expect(body.workflow_instance_id).toBe("wf-instance-123")
      expect(body.status).toBe("queued")
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

  describe("budget-inputs violation dispatches to workflow", () => {
    it("returns 202 even for violation payloads (workflow handles evaluation)", async () => {
      const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-violation-456" })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
      })

      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, env)

      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.call_id).toBe("e2e-call-123")
      expect(body.module).toBe("budget_inputs")
      expect(body.workflow_instance_id).toBe("wf-violation-456")
      expect(body.status).toBe("queued")
      expect(body.correlation_id).toBeTruthy()
      expect(body.timestamp).toBeTruthy()

      // Verify workflow was triggered with correct params
      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe("e2e-call-123-budget_inputs")
      expect(createArgs.params.moduleName).toBe("budget_inputs")
      expect(createArgs.params.callData.call_id).toBe("e2e-call-123")
    })
  })
})
