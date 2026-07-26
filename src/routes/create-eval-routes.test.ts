import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { MODULE_NAMES } from "../modules/constants"

import { createEvalRoutes } from "./create-eval-routes"

const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "test-instance-id" })
const mockLogRequest = vi.fn().mockResolvedValue(undefined)
const mockGetBackfillCallData = vi.fn()
const mockGetBackfillCandidatePage = vi.fn()
const mockGetResolverPolicy = vi.fn().mockResolvedValue({
  policy: {
    enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
    enrollmentMinDurationSeconds: 1200,
  },
  policyVersion: 1,
})
const routeDependencies = {
  createDatabase: () => ({
    logRequest: mockLogRequest,
    getBackfillCallData: mockGetBackfillCallData,
    getBackfillCandidatePage: mockGetBackfillCandidatePage,
    getResolverPolicy: mockGetResolverPolicy,
  }),
}

function createApp(endpoint: string, moduleName: string) {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", createEvalRoutes({ endpoint, moduleName }, routeDependencies))
  return app
}

function createEnvWithWorkflow(environment = "test") {
  return createEnv({
    ENVIRONMENT: environment,
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
  { endpoint: "achieve-welcome-call-qa", moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA },
] as const

describe.each(modules)("$endpoint routes", ({ endpoint, moduleName }) => {
  beforeEach(() => {
    mockWorkflowCreate.mockClear()
    mockWorkflowCreate.mockResolvedValue({ id: "test-instance-id" })
    mockLogRequest.mockClear()
    mockGetBackfillCallData.mockReset()
    mockGetBackfillCandidatePage.mockReset()
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
      }, createEnvWithWorkflow("production"))
      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe(`test-call-123-${moduleName}`)
      expect(createArgs.params.moduleName).toBe(moduleName)
      expect(createArgs.params.callData.call_id).toBe("test-call-123")
      expect(createArgs.retention).toEqual({
        successRetention: "7 days",
        errorRetention: "14 days",
      })
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
      }, createEnvWithWorkflow("staging"))
      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.total).toBe(1)
      expect(body.instances).toHaveLength(1)
      expect(body.instances[0].id).toBe("test-instance-id")
      expect(body.status).toBe("queued")
      expect(mockWorkflowCreate.mock.calls[0][0].retention).toEqual({
        successRetention: "1 day",
        errorRetention: "3 days",
      })
    })

    it("passes backfill execution context into every queued workflow", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          calls: [validBody],
          execution: { mode: "backfill", run_id: "regal-outage-2026-07" },
        }),
      }, createEnvWithWorkflow("production"))

      expect(res.status).toBe(202)
      expect(mockWorkflowCreate).toHaveBeenCalledOnce()
      expect(mockWorkflowCreate.mock.calls[0][0].params.execution).toEqual({
        mode: "backfill",
        run_id: "regal-outage-2026-07",
      })
      expect((await res.json() as any).execution).toEqual({
        mode: "backfill",
        run_id: "regal-outage-2026-07",
      })
    })

    it("reports already-existing workflow ids without failing the whole batch", async () => {
      const calls = [
        { ...validBody, call_id: "new-call" },
        { ...validBody, call_id: "existing-call" },
      ]
      mockWorkflowCreate
        .mockResolvedValueOnce({ id: `new-call-${moduleName}` })
        .mockRejectedValueOnce(new Error("workflow instance already exists"))
      const app = createApp(endpoint, moduleName)

      const res = await app.request(`/api/v1/evaluate/${endpoint}/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          calls,
          execution: { mode: "backfill", run_id: "regal-outage-2026-07" },
        }),
      }, createEnvWithWorkflow("production"))

      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.instances).toEqual([
        {
          call_id: "new-call",
          id: `new-call-${moduleName}`,
          status: "queued",
        },
        {
          call_id: "existing-call",
          id: `existing-call-${moduleName}`,
          status: "already_exists",
        },
      ])
      expect(body.summary).toEqual({ queued: 1, already_exists: 1, errors: 0 })
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

  describe(`POST /evaluate/${endpoint}/from-recording`, () => {
    const validRecordingBody = {
      call_id: "rec-call-1",
      agent_id: "agent-456",
      recording_url: "https://api.twilio.com/REC123",
      metadata: { timestamp: "2025-01-01T00:00:00Z" },
    }

    it("returns 401 without auth", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRecordingBody),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(401)
    })

    it("returns 400 without recording_url", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify({ call_id: "x", agent_id: "y", metadata: { timestamp: "t" } }),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(400)
    })

    it("returns 202 and passes the recording param to the workflow", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify(validRecordingBody),
      }, createEnvWithWorkflow("development"))

      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe(moduleName)
      expect(body.status).toBe("queued")
      expect(body.call_id).toBe("rec-call-1")
      expect(body.workflow_instance_id).toBe("test-instance-id")

      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe(`rec-call-1-${moduleName}`)
      expect(createArgs.params.recording).toEqual({ url: "https://api.twilio.com/REC123", source: "twilio" })
      expect(createArgs.params.callData.transcript.transcript).toBe("")
      expect(createArgs.params.callData.recording_link).toBe("https://api.twilio.com/REC123")
      expect(createArgs.retention).toEqual({
        successRetention: "1 day",
        errorRetention: "3 days",
      })
    })
  })
})

describe("backfill-by-ID route", () => {
  beforeEach(() => {
    mockWorkflowCreate.mockReset()
    mockWorkflowCreate.mockResolvedValue({ id: "test-instance-id" })
    mockGetBackfillCallData.mockReset()
    mockGetBackfillCandidatePage.mockReset()
    mockGetBackfillCallData.mockImplementation(async (callId: string) => ({
      ...validBody,
      call_id: callId,
    }))
  })

  it("loads restored source rows internally and queues a silent workflow", async () => {
    const app = createApp("full-qa", MODULE_NAMES.FULL_QA)
    const res = await app.request("/api/v1/evaluate/full-qa/backfill", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        call_ids: ["call-1"],
        run_id: "regal-outage-2026-07-smoke-1",
      }),
    }, createEnvWithWorkflow("production"))

    expect(res.status).toBe(202)
    expect(mockGetBackfillCallData).toHaveBeenCalledWith("call-1")
    expect(mockWorkflowCreate).toHaveBeenCalledOnce()
    expect(mockWorkflowCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: `call-1-${MODULE_NAMES.FULL_QA}`,
      params: expect.objectContaining({
        execution: {
          mode: "backfill",
          run_id: "regal-outage-2026-07-smoke-1",
        },
      }),
    }))
    const body = (await res.json()) as any
    expect(body).not.toHaveProperty("calls")
    expect(body.instances).toEqual([{
      call_id: "call-1",
      id: "test-instance-id",
      status: "queued",
    }])
  })

  it("discovers and queues the next checkpointed source page", async () => {
    mockGetBackfillCandidatePage.mockResolvedValue({
      call_ids: ["call-1"],
      next_cursor: "call-10",
      scanned: 10,
    })
    const app = createApp("full-qa", MODULE_NAMES.FULL_QA)

    const res = await app.request("/api/v1/evaluate/full-qa/backfill-next", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        start: "2026-07-26T10:04:00Z",
        end: "2026-07-26T10:10:00Z",
        run_id: "regal-outage-2026-07-full-1",
      }),
    }, createEnvWithWorkflow("production"))

    expect(res.status).toBe(202)
    expect(mockGetBackfillCandidatePage).toHaveBeenCalledWith(expect.objectContaining({
      moduleName: MODULE_NAMES.FULL_QA,
      filter: "all",
      limit: 10,
    }))
    expect(mockWorkflowCreate).toHaveBeenCalledOnce()
    const body = (await res.json()) as any
    expect(body.next_cursor).toBe("call-10")
    expect(body.scanned).toBe(10)
    expect(body.summary.queued).toBe(1)
  })
})

describe("requiredPartnerId validation", () => {
  beforeEach(() => {
    mockWorkflowCreate.mockClear()
    mockWorkflowCreate.mockResolvedValue({ id: "test-instance-id" })
    mockLogRequest.mockClear()
    mockGetBackfillCallData.mockReset()
    mockGetBackfillCandidatePage.mockReset()
  })

  it("returns 400 when partner_id in body does not match requiredPartnerId", async () => {
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createEvalRoutes({
      endpoint: "achieve-welcome-call-qa",
      moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      requiredPartnerId: "achieve",
    }, routeDependencies))

    const res = await app.request("/api/v1/evaluate/achieve-welcome-call-qa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ ...validBody, partner_id: "wrong-partner" }),
    }, createEnvWithWorkflow())

    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toContain("achieve")
  })

  it("returns 202 when partner_id matches requiredPartnerId", async () => {
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createEvalRoutes({
      endpoint: "achieve-welcome-call-qa",
      moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      requiredPartnerId: "achieve",
    }, routeDependencies))

    const res = await app.request("/api/v1/evaluate/achieve-welcome-call-qa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ ...validBody, partner_id: "achieve" }),
    }, createEnvWithWorkflow())

    expect(res.status).toBe(202)
  })

  it("returns 202 when partner_id is absent (no enforcement on missing)", async () => {
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createEvalRoutes({
      endpoint: "achieve-welcome-call-qa",
      moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      requiredPartnerId: "achieve",
    }, routeDependencies))

    const res = await app.request("/api/v1/evaluate/achieve-welcome-call-qa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify(validBody),
    }, createEnvWithWorkflow())

    expect(res.status).toBe(202)
  })
})
