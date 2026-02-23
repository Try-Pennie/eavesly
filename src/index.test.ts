import { describe, it, expect, vi } from "vitest"
import { createEnv, TEST_API_KEY } from "../test/helpers/mock-env"

const { mockStoreModuleResult } = vi.hoisted(() => ({
  mockStoreModuleResult: vi.fn().mockResolvedValue(undefined),
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
  dispatchAlerts: vi.fn(),
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

    it("rejects unauthenticated litigation-check request", async () => {
      const res = await app.request("/api/v1/evaluate/litigation-check", {
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

  describe("full-qa workflow dispatch", () => {
    it("returns 202 with workflow_instance_id", async () => {
      const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-instance-123" })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
      })
      const res = await app.request("/api/v1/evaluate/full-qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, env)
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe("full_qa")
      expect(body.workflow_instance_id).toBe("wf-instance-123")
      expect(body.status).toBe("queued")

      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe("e2e-call-123-full_qa")
      expect(createArgs.params.moduleName).toBe("full_qa")
      expect(createArgs.params.callData.call_id).toBe("e2e-call-123")
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

  describe("warm-transfer workflow dispatch", () => {
    it("returns 202 with workflow_instance_id", async () => {
      const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-instance-123" })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
      })
      const res = await app.request("/api/v1/evaluate/warm-transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, env)
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe("warm_transfer")
      expect(body.workflow_instance_id).toBe("wf-instance-123")
      expect(body.status).toBe("queued")

      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe("e2e-call-123-warm_transfer")
      expect(createArgs.params.moduleName).toBe("warm_transfer")
      expect(createArgs.params.callData.call_id).toBe("e2e-call-123")
    })
  })

  describe("litigation-check workflow dispatch", () => {
    it("rejects unauthenticated request", async () => {
      const res = await app.request("/api/v1/evaluate/litigation-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnv())
      expect(res.status).toBe(401)
    })

    it("returns 202 with workflow_instance_id", async () => {
      const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-instance-123" })
      const env = createEnv({
        EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
      })
      const res = await app.request("/api/v1/evaluate/litigation-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, env)
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe("litigation_check")
      expect(body.workflow_instance_id).toBe("wf-instance-123")
      expect(body.status).toBe("queued")

      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe("e2e-call-123-litigation_check")
      expect(createArgs.params.moduleName).toBe("litigation_check")
      expect(createArgs.params.callData.call_id).toBe("e2e-call-123")
    })
  })
})
