import type { Alert } from "../modules/types"
import type { Bindings } from "../types/env"
import type { FullQAResult } from "../schemas/full-qa"
import type { BudgetInputsResult } from "../schemas/budget-inputs"
import type { WarmTransferResult } from "../schemas/warm-transfer"
import type { LitigationCheckResult } from "../schemas/litigation-check"
import { VIOLATION_TYPES } from "../modules/constants"
import { log } from "../utils/logger"
import { createClient } from "@supabase/supabase-js"

const INVALID_MANAGER_VALUES = ["no longer at pennie", "none"]

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

export async function processAlert(alert: Alert, env: Bindings): Promise<void> {
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

  const managerEmail = await lookupManagerEmail(env, alert.agent_email)
  const payload = buildSlackPayload(alert, managerEmail)

  log("info", "Slack payload built", {
    callId: alert.call_id,
    fields: Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, v ? v.length : 0])
    ),
  })

  log("info", "Sending Slack webhook", {
    callId: alert.call_id,
    webhookUrlTail: env.SLACK_WEBHOOK_URL.slice(-8),
  })

  await sendSlackWebhook(env.SLACK_WEBHOOK_URL, payload)
}

export async function lookupManagerEmail(
  env: Bindings,
  agentEmail: string | undefined,
): Promise<string> {
  if (!agentEmail) return ""

  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await supabase
      .from("agent_manager_mapping")
      .select("manager_email")
      .eq("agent_email", agentEmail)
      .single()

    if (error || !data?.manager_email) return ""

    if (INVALID_MANAGER_VALUES.includes(data.manager_email.toLowerCase())) {
      return ""
    }

    return data.manager_email
  } catch (err) {
    log("warn", "Manager email lookup failed", {
      agentEmail,
      error: err instanceof Error ? err.message : String(err),
    })
    return ""
  }
}

export interface SlackPayload {
  call_id: string
  violation_type: string
  module_name: string
  agent_email: string
  manager_email: string
  summary: string
  timestamp: string
  evidence: string
  detail: string
  contact_name: string
  recording_link: string
  transcript_url: string
  sfdc_lead_id: string
  call_duration: string
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || seconds < 0) return ""
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function buildSlackPayload(alert: Alert, managerEmail = ""): SlackPayload {
  return {
    call_id: alert.call_id,
    violation_type: alert.violation_type,
    module_name: alert.module_name,
    agent_email: alert.agent_email ?? "",
    manager_email: managerEmail,
    summary: buildSummary(alert),
    timestamp: new Date().toISOString(),
    evidence: extractEvidence(alert),
    detail: extractDetail(alert),
    contact_name: alert.contact_name ?? "",
    recording_link: alert.recording_link ?? "",
    transcript_url: alert.transcript_url ?? "",
    sfdc_lead_id: alert.sfdc_lead_id ?? "",
    call_duration: formatDuration(alert.call_duration),
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
    case VIOLATION_TYPES.LITIGATION_CHECK:
      return "Litigation check"
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
    case VIOLATION_TYPES.LITIGATION_CHECK: {
      return (result as LitigationCheckResult)?.violation_reason || "Litigation check issue"
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
    case VIOLATION_TYPES.LITIGATION_CHECK: {
      return (result as LitigationCheckResult)?.key_evidence_quote || ""
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
        { name: "Housing Status", ...r?.housing_status },
        { name: "Housing", ...r?.housing },
        { name: "Housing Insurance", ...r?.housing_insurance },
        { name: "Utilities", ...r?.utilities },
        { name: "Phone/Internet/TV", ...r?.phone_internet_tv },
        { name: "Car Payment", ...r?.car_payment },
        { name: "Car Insurance", ...r?.car_insurance },
        { name: "Car Fuel", ...r?.car_fuel },
        { name: "Food & Groceries", ...r?.food_and_groceries },
        { name: "Medical", ...r?.medical },
        { name: "Health & Life Insurance", ...r?.health_and_life_insurance },
        { name: "Household", ...r?.household },
        { name: "Personal Care", ...r?.personal_care },
        { name: "Student Loans", ...r?.student_loans },
        { name: "Legal", ...r?.legal },
        { name: "Alimony & Child Support", ...r?.alimony_and_child_support },
        { name: "Back Taxes", ...r?.back_taxes },
        { name: "Dependent Care", ...r?.dependent_care },
        { name: "Other Debts", ...r?.other_debts },
      ]
      const notCollected = categories.filter((c) => !c.collected)
      const collected = categories.filter((c) => c.collected)

      const lines: string[] = []
      if (notCollected.length > 0) {
        lines.push("❌ Not Collected")
        lines.push(...notCollected.map((c) => c.name))
      }
      if (collected.length > 0) {
        if (lines.length > 0) lines.push("")
        lines.push("✅ Collected")
        lines.push(...collected.map((c) => c.name))
      }
      return lines.join("\n")
    }
    case VIOLATION_TYPES.WARM_TRANSFER: {
      const reason = (result as WarmTransferResult)?.warm_transfer_compliance?.violation_reason
      return reason || "No transfer attempted"
    }
    case VIOLATION_TYPES.LITIGATION_CHECK: {
      const r = result as LitigationCheckResult
      const lines: string[] = []
      if (r?.mentions?.length > 0) {
        lines.push("Litigation/Collections Mentions:")
        for (const m of r.mentions) {
          lines.push(`- "${m.quote}" (${m.term_used}, ${m.speaker})`)
        }
      }
      if (r?.agent_response_quote) {
        lines.push("")
        lines.push(`Agent Response: "${r.agent_response_quote}"`)
      }
      return lines.join("\n") || "Litigation check issue"
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

  const responseBody = await response.text()

  log(response.ok ? "info" : "error", "Slack webhook response", {
    status: response.status,
    statusText: response.statusText,
    body: responseBody,
  })

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed: ${response.status} ${response.statusText} — ${responseBody}`,
    )
  }
}
