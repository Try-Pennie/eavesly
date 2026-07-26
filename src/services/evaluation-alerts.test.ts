import { describe, expect, it } from "vitest"
import type { Alert } from "../modules/types"
import { deliverEvaluationAlerts } from "./evaluation-alerts"

const alert: Alert = {
  module_name: "full_qa",
  violation_type: "manager_escalation",
  call_id: "call-1",
  agent_id: "agent-1",
  result: { manager_review_required: true },
}

describe("deliverEvaluationAlerts()", () => {
  it("suppresses every delivery during a backfill run", async () => {
    const delivered: Alert[] = []

    const result = await deliverEvaluationAlerts(
      [alert],
      { mode: "backfill", run_id: "regal-outage-2026-07" },
      async (candidate) => {
        delivered.push(candidate)
      },
    )

    expect(delivered).toEqual([])
    expect(result).toEqual({ status: "suppressed", alert_count: 1 })
  })

  it("preserves normal alert delivery for live evaluations", async () => {
    const delivered: Alert[] = []

    const result = await deliverEvaluationAlerts(
      [alert],
      { mode: "live" },
      async (candidate) => {
        delivered.push(candidate)
      },
    )

    expect(delivered).toEqual([alert])
    expect(result).toEqual({ status: "dispatched", alert_count: 1 })
  })
})
