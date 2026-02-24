import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { MODULE_NAMES } from "../modules/constants"

vi.mock("../services/database", () => ({
  DatabaseService: class {
    storeModuleResult = vi.fn().mockResolvedValue(undefined)
    storeQAResult = vi.fn().mockResolvedValue(undefined)
    logRequest = vi.fn().mockResolvedValue(undefined)
  },
}))

import { createEvalRoutes } from "./create-eval-routes"

const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "test-instance-id" })

function createApp(endpoint: string, moduleName: string) {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", createEvalRoutes({ endpoint, moduleName }))
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

const modules = [
  { endpoint: "full-qa", moduleName: MODULE_NAMES.FULL_QA },
  { endpoint: "budget-inputs", moduleName: MODULE_NAMES.BUDGET_INPUTS },
  { endpoint: "warm-transfer", moduleName: MODULE_NAMES.WARM_TRANSFER },
  { endpoint: "litigation-check", moduleName: MODULE_NAMES.LITIGATION_CHECK },
] as const

describe.each(modules)("$endpoint routes", ({ endpoint, moduleName }) => {
  beforeEach(() => {
    mockWorkflowCreate.mockClear()
    mockWorkflowCreate.mockResolvedValue({ id: "test-instance-id" })
  })

  describe(`POST /evaluate/${endpoint}`, () => {
    it("returns 401 without auth", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(401)
    })

    it("returns 400 with invalid body", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}`, {
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
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe(moduleName)
      expect(body.workflow_instance_id).toBe("test-instance-id")
      expect(body.status).toBe("queued")
      expect(body.call_id).toBe("test-call-123")
    })

    it("calls EVALUATION_WORKFLOW.create with correct params", async () => {
      const app = createApp(endpoint, moduleName)
      await app.request(`/api/v1/evaluate/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(validBody),
      }, createEnvWithWorkflow())
      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe(`test-call-123-${moduleName}`)
      expect(createArgs.params.moduleName).toBe(moduleName)
      expect(createArgs.params.callData.call_id).toBe("test-call-123")
    })
  })

  describe(`POST /evaluate/${endpoint}/batch`, () => {
    it("returns 202 with workflow instances", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
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
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
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
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ calls: [] }),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(400)
    })

    it("returns 401 without auth", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calls: [validBody] }),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(401)
    })
  })
})
