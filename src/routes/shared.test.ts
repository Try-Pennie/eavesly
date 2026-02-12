import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { evaluateAndRespond, batchEvaluateAndRespond } from "./shared"
import { createMockDB, createFailingDB } from "../../test/helpers/mock-database"
import { createEvaluateRequest } from "../../test/helpers/create-request"
import { MODULE_NAMES, VIOLATION_TYPES } from "../modules/constants"
import type { EvalModule, ModuleResult } from "../modules/types"

const mockDispatchAlerts = vi.fn()
vi.mock("../services/alerts", () => ({
  dispatchAlerts: (...args: any[]) => mockDispatchAlerts(...args),
}))

function createMockModule(overrides: Partial<ModuleResult> = {}): EvalModule {
  const defaultResult: ModuleResult = {
    module_name: MODULE_NAMES.FULL_QA,
    result: { test: true },
    has_violation: false,
    violation_type: null,
    processing_time_ms: 100,
    ...overrides,
  }
  return {
    name: defaultResult.module_name,
    evaluate: vi.fn().mockResolvedValue(defaultResult),
    extractAlerts: vi.fn().mockReturnValue(
      defaultResult.has_violation
        ? [{
            module_name: defaultResult.module_name,
            violation_type: defaultResult.violation_type,
            call_id: "test",
            result: defaultResult.result,
          }]
        : [],
    ),
  }
}

function createTestApp(handler: any) {
  const app = new Hono<AppEnv>()
  app.post("/test", handler)
  return app
}

describe("evaluateAndRespond", () => {
  beforeEach(() => {
    mockDispatchAlerts.mockReset()
  })

  it("calls module.evaluate with transcript", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    await app.request("/test", { method: "POST" })
    expect(module.evaluate).toHaveBeenCalledWith(
      callData.transcript.transcript,
      callData,
      expect.anything(),
    )
  })

  it("stores module result in database", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    await app.request("/test", { method: "POST" })
    expect(db.storeModuleResult).toHaveBeenCalledWith(
      callData.call_id,
      expect.anything(),
      false,
    )
  })

  it("stores QA result for full_qa module only", async () => {
    const module = createMockModule({ module_name: MODULE_NAMES.FULL_QA })
    module.name = MODULE_NAMES.FULL_QA
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    await app.request("/test", { method: "POST" })
    expect(db.storeQAResult).toHaveBeenCalled()
  })

  it("does not store QA result for non-full_qa modules", async () => {
    const module = createMockModule({ module_name: MODULE_NAMES.BUDGET_INPUTS })
    module.name = MODULE_NAMES.BUDGET_INPUTS
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    await app.request("/test", { method: "POST" })
    expect(db.storeQAResult).not.toHaveBeenCalled()
  })

  it("dispatches alerts when violations found", async () => {
    const module = createMockModule({
      has_violation: true,
      violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
    })
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    const mockExecCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    await app.request("/test", { method: "POST" }, {}, mockExecCtx)
    expect(mockDispatchAlerts).toHaveBeenCalled()
  })

  it("does not dispatch alerts when no violations", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    await app.request("/test", { method: "POST" })
    expect(mockDispatchAlerts).not.toHaveBeenCalled()
  })

  it("returns correct JSON shape", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const callData = createEvaluateRequest()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "test-id")
      return evaluateAndRespond(c, module, callData, {} as any, db as any)
    })

    const res = await app.request("/test", { method: "POST" })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.call_id).toBe(callData.call_id)
    expect(body.module).toBe(MODULE_NAMES.FULL_QA)
    expect(body.correlation_id).toBe("test-id")
    expect(body.timestamp).toBeTruthy()
    expect(body.processing_time_ms).toBeGreaterThanOrEqual(0)
    expect(body.has_violation).toBe(false)
    expect(body.alert_dispatched).toBe(false)
  })
})

describe("batchEvaluateAndRespond", () => {
  beforeEach(() => {
    mockDispatchAlerts.mockReset()
  })

  it("processes multiple calls", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const calls = [
      createEvaluateRequest({ call_id: "call-1" }),
      createEvaluateRequest({ call_id: "call-2" }),
    ]
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "batch-id")
      return batchEvaluateAndRespond(c, module, calls, {} as any, db as any)
    })

    const res = await app.request("/test", { method: "POST" })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.total).toBe(2)
    expect(body.success).toBe(2)
    expect(body.failed).toBe(0)
    expect(body.success_rate).toBe(100)
  })

  it("reports failures correctly", async () => {
    const module: EvalModule = {
      name: MODULE_NAMES.FULL_QA,
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          module_name: MODULE_NAMES.FULL_QA,
          result: {},
          has_violation: false,
          violation_type: null,
          processing_time_ms: 50,
        })
        .mockRejectedValueOnce(new Error("Processing failed")),
      extractAlerts: vi.fn().mockReturnValue([]),
    }
    const db = createMockDB()
    const calls = [
      createEvaluateRequest({ call_id: "call-1" }),
      createEvaluateRequest({ call_id: "call-2" }),
    ]
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "batch-id")
      return batchEvaluateAndRespond(c, module, calls, {} as any, db as any)
    })

    const res = await app.request("/test", { method: "POST" })
    const body = (await res.json()) as any
    expect(body.success).toBe(1)
    expect(body.failed).toBe(1)
    expect(body.results).toHaveLength(2)

    const failed = body.results.find((r: any) => r.status === "error")
    expect(failed.error).toContain("Processing failed")
  })

  it("includes correlation_id and timestamp in batch response", async () => {
    const module = createMockModule()
    const db = createMockDB()
    const app = createTestApp(async (c: any) => {
      c.set("correlationId", "batch-id")
      return batchEvaluateAndRespond(
        c,
        module,
        [createEvaluateRequest()],
        {} as any,
        db as any,
      )
    })

    const res = await app.request("/test", { method: "POST" })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.correlation_id).toBe("batch-id")
    expect(body.timestamp).toBeTruthy()
    expect(body.processing_time_ms).toBeGreaterThanOrEqual(0)
  })
})
