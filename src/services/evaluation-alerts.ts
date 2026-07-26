import type { Alert } from "../modules/types"
import type { EvaluationExecution } from "../schemas/evaluation-execution"

export type AlertDeliveryResult = {
  status: "dispatched" | "suppressed"
  alert_count: number
}

export async function deliverEvaluationAlerts(
  alerts: readonly Alert[],
  execution: EvaluationExecution,
  deliver: (alert: Alert) => Promise<void>,
): Promise<AlertDeliveryResult> {
  if (execution.mode === "backfill") {
    return { status: "suppressed", alert_count: alerts.length }
  }

  for (const alert of alerts) {
    await deliver(alert)
  }

  return { status: "dispatched", alert_count: alerts.length }
}
