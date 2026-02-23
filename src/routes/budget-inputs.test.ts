import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

vi.mock("../services/database", () => ({
  DatabaseService: class {
    storeModuleResult = vi.fn().mockResolvedValue(undefined)
    storeQAResult = vi.fn().mockResolvedValue(undefined)
    logRequest = vi.fn().mockResolvedValue(undefined)
  },
}))

import { budgetInputsRoutes } from "./budget-inputs"

const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "test-instance-id" })

function createApp() {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", budgetInputsRoutes)
  return app
}

function createEnvWithWorkflow() {
  return createEnv({
    EVALUATION_WORKFLOW: { create: mockWorkflowCreate, get: vi.fn() } as any,
  })
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
    mockWorkflowCreate.mockClear()
    mockWorkflowCreate.mockResolvedValue({ id: "test-instance-id" })
  })

  describe("POST /evaluate/budget-inputs", () => {
    it("returns 401 without auth", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
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
      }, createEnvWithWorkflow())
      expect(res.status).toBe(400)
    })

    it("returns 202 with workflow_instance_id for valid request", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe("budget_inputs")
      expect(body.workflow_instance_id).toBe("test-instance-id")
      expect(body.status).toBe("queued")
      expect(body.call_id).toBe("test-call-123")
    })

    it("calls EVALUATION_WORKFLOW.create with correct params", async () => {
      const app = createApp()
      await app.request("/api/v1/evaluate/budget-inputs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe("test-call-123-budget_inputs")
      expect(createArgs.params.moduleName).toBe("budget_inputs")
      expect(createArgs.params.callData.call_id).toBe("test-call-123")
    })
  })

  describe("POST /evaluate/budget-inputs/batch", () => {
    it("returns 202 with workflow instances", async () => {
      const app = createApp()
      const res = await app.request("/api/v1/evaluate/budget-inputs/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ calls: [validBody] }),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.total).toBe(1)
      expect(body.instances).toHaveLength(1)
      expect(body.instances[0].id).toBe("test-instance-id")
      expect(body.status).toBe("queued")
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
      }, createEnvWithWorkflow())
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
      }, createEnvWithWorkflow())
      expect(res.status).toBe(400)
    })
  })
})
