import type { Alert } from "../modules/types"
import { log } from "../utils/logger"

export async function dispatchAlerts(
  alerts: Alert[],
  ctx: ExecutionContext,
): Promise<void> {
  for (const alert of alerts) {
    ctx.waitUntil(
      processAlert(alert).catch((error) => {
        log("error", "Alert dispatch failed", {
          module: alert.module_name,
          callId: alert.call_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }),
    )
  }
}

async function processAlert(alert: Alert): Promise<void> {
  log("info", "Alert dispatched", {
    module: alert.module_name,
    violationType: alert.violation_type,
    callId: alert.call_id,
  })
  // Future: Slack webhook, Supabase edge function trigger, email, etc.
}
