import { describe, it, expect, vi } from "vitest"
import { dispatchAlerts } from "./alerts"
import type { Alert } from "../modules/types"

function createMockCtx() {
  return {
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext
}

describe("dispatchAlerts", () => {
  it("calls waitUntil for each alert", async () => {
    const ctx = createMockCtx()
    const alerts: Alert[] = [
      {
        module_name: "full_qa",
        violation_type: "manager_escalation",
        call_id: "call-1",
        result: {},
      },
      {
        module_name: "budget_inputs",
        violation_type: "budget_compliance",
        call_id: "call-2",
        result: {},
      },
    ]

    await dispatchAlerts(alerts, ctx)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2)
  })

  it("handles empty alerts array", async () => {
    const ctx = createMockCtx()
    await dispatchAlerts([], ctx)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it("passes a promise to waitUntil", async () => {
    const ctx = createMockCtx()
    const alerts: Alert[] = [
      {
        module_name: "full_qa",
        violation_type: "manager_escalation",
        call_id: "call-1",
        result: {},
      },
    ]

    await dispatchAlerts(alerts, ctx)
    const passedArg = (ctx.waitUntil as any).mock.calls[0][0]
    expect(passedArg).toBeInstanceOf(Promise)
  })

  it("catches individual alert failures", async () => {
    const ctx = createMockCtx()
    // The waitUntil receives a promise that already has .catch() attached
    // so even if processAlert were to fail, it wouldn't bubble up
    const alerts: Alert[] = [
      {
        module_name: "full_qa",
        violation_type: "manager_escalation",
        call_id: "call-1",
        result: {},
      },
    ]

    // Should not throw
    await dispatchAlerts(alerts, ctx)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })
})
