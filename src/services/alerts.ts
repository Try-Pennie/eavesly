import type { Alert } from "../modules/types"
import type { Bindings } from "../types/env"
import type { FullQAResult } from "../schemas/full-qa"
import type { BudgetInputsResult } from "../schemas/budget-inputs"
import type { WarmTransferResult } from "../schemas/warm-transfer"
import { VIOLATION_TYPES } from "../modules/constants"
import { log } from "../utils/logger"

export async function dispatchAlerts(
  alerts: Alert[],
  ctx: ExecutionContext,
  env: Bindings,
): Promise<void> {
  for (const alert of alerts) {
    ctx.waitUntil(
      processAlert(alert, env).catch((error) => {
        log("error", "Alert dispatch failed", {
          module: alert.module_name,
          callId: alert.call_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }),
    )
  }
}

async function processAlert(alert: Alert, env: Bindings): Promise<void> {
  log("info", "Alert dispatched", {
    module: alert.module_name,
    violationType: alert.violation_type,
    callId: alert.call_id,
  })

  if (!env.SLACK_WEBHOOK_URL) {
    log("warn", "SLACK_WEBHOOK_URL not set, skipping Slack notification", {
      callId: alert.call_id,
    })
    return
  }

  const payload = buildSlackPayload(alert)
  await sendSlackWebhook(env.SLACK_WEBHOOK_URL, payload)
}

export interface SlackPayload {
  call_id: string
  violation_type: string
  module_name: string
  agent_email: string
  summary: string
  timestamp: string
  evidence: string
  detail: string
  contact_name: string
  recording_link: string
}

export function buildSlackPayload(alert: Alert): SlackPayload {
  return {
    call_id: alert.call_id,
    violation_type: alert.violation_type,
    module_name: alert.module_name,
    agent_email: alert.agent_email ?? "",
    summary: buildSummary(alert),
    timestamp: new Date().toISOString(),
    evidence: extractEvidence(alert),
    detail: extractDetail(alert),
    contact_name: alert.contact_name ?? "",
    recording_link: alert.recording_link ?? "",
  }
}

export function buildSummary(alert: Alert): string {
  const prefix = `${formatViolationType(alert.violation_type)} violation on call ${alert.call_id}`
  const reason = extractViolationReason(alert)
  return reason ? `${prefix}: ${reason}` : prefix
}

function formatViolationType(type: string): string {
  switch (type) {
    case VIOLATION_TYPES.MANAGER_ESCALATION:
      return "Manager escalation"
    case VIOLATION_TYPES.BUDGET_COMPLIANCE:
      return "Budget compliance"
    case VIOLATION_TYPES.WARM_TRANSFER:
      return "Warm transfer"
    default:
      return type
  }
}

function extractViolationReason(alert: Alert): string {
  const result = alert.result as Record<string, any>

  switch (alert.violation_type) {
    case VIOLATION_TYPES.MANAGER_ESCALATION: {
      return (result as FullQAResult)?.call_overview?.manager_review_reason || "Manager review required"
    }
    case VIOLATION_TYPES.BUDGET_COMPLIANCE: {
      return (result as BudgetInputsResult)?.violation_reason || "Budget compliance issue"
    }
    case VIOLATION_TYPES.WARM_TRANSFER: {
      return (result as WarmTransferResult)?.warm_transfer_compliance?.violation_reason || "No transfer attempted"
    }
    default:
      return ""
  }
}

function extractEvidence(alert: Alert): string {
  const result = alert.result as Record<string, any>

  switch (alert.violation_type) {
    case VIOLATION_TYPES.MANAGER_ESCALATION: {
      const areas = (result as FullQAResult)?.call_overview?.manager_focus_areas
      return areas?.map((a: { quote: string }) => a.quote).join("; ") || ""
    }
    case VIOLATION_TYPES.BUDGET_COMPLIANCE: {
      return (result as BudgetInputsResult)?.key_evidence_quote || ""
    }
    case VIOLATION_TYPES.WARM_TRANSFER: {
      return (result as WarmTransferResult)?.warm_transfer_compliance?.violation_reason || ""
    }
    default:
      return ""
  }
}

function extractDetail(alert: Alert): string {
  const result = alert.result as Record<string, any>

  switch (alert.violation_type) {
    case VIOLATION_TYPES.MANAGER_ESCALATION: {
      const reason = (result as FullQAResult)?.call_overview?.manager_review_reason
      return reason || "Manager review required"
    }
    case VIOLATION_TYPES.BUDGET_COMPLIANCE: {
      const r = result as BudgetInputsResult
      const categories = [
        { name: "Housing", ...r?.housing_payment },
        { name: "Auto", ...r?.auto_payment },
        { name: "Utilities", ...r?.utilities },
        { name: "Other", ...r?.other_debts_expenses },
      ]
      return categories
        .map((c) => `${c.name}: ${c.collected ? "collected" : "skipped"}`)
        .join(", ")
    }
    case VIOLATION_TYPES.WARM_TRANSFER: {
      const reason = (result as WarmTransferResult)?.warm_transfer_compliance?.violation_reason
      return reason || "No transfer attempted"
    }
    default:
      return ""
  }
}

async function sendSlackWebhook(
  url: string,
  payload: SlackPayload,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed: ${response.status} ${response.statusText}`,
    )
  }
}
