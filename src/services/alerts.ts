import type { Alert } from "../modules/types"
import type { Bindings } from "../types/env"
import type { FullQAResult } from "../schemas/full-qa"
import type { BudgetInputsResult } from "../schemas/budget-inputs"
import type { WarmTransferResult } from "../schemas/warm-transfer"
import type { LitigationCheckResult } from "../schemas/litigation-check"
import type { ProgramExpectationsResult } from "../schemas/program-expectations"
import type { ActiveSettlementsResult } from "../schemas/active-settlements"
import { MODULE_NAMES, VIOLATION_TYPES } from "../modules/constants"
import { log } from "../utils/logger"
import { createClient } from "@supabase/supabase-js"

const INVALID_MANAGER_VALUES = ["no longer at pennie", "none"]

const JOEL_NELSON_EMAIL = "jnelson@trypennie.com"

function shouldMirrorToJoel(alert: Alert): boolean {
  if (alert.agent_email?.toLowerCase() !== JOEL_NELSON_EMAIL) return false

  // TEMPORARY: disposition-review is being tested in production and is hidden
  // from manager-facing surfaces. Keep Joel's mirror muted for this module too.
  if (alert.module_name === MODULE_NAMES.DISPOSITION_REVIEW) return false
  if (alert.violation_type === VIOLATION_TYPES.MIS_DISPOSITION) return false

  return true
}

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

  const isFullQA = alert.violation_type === VIOLATION_TYPES.MANAGER_ESCALATION
  const webhookUrl = isFullQA ? env.SLACK_WEBHOOK_URL_FULL_QA : env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    log("warn", `${isFullQA ? "SLACK_WEBHOOK_URL_FULL_QA" : "SLACK_WEBHOOK_URL"} not set, skipping Slack notification`, {
      callId: alert.call_id,
    })
    return
  }

  const managerEmail = await lookupManagerEmail(env, alert.agent_email)
  const reviewUrl = buildReviewUrl(env, alert.call_id, alert.module_name)
  const payload = isFullQA
    ? buildFullQASlackPayload(alert, managerEmail, reviewUrl)
    : buildSlackPayload(alert, managerEmail, reviewUrl)

  log("info", "Slack payload built", {
    callId: alert.call_id,
    fields: Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, typeof v === "string" ? v.length : 0])
    ),
  })

  log("info", "Sending Slack webhook", {
    callId: alert.call_id,
    webhookUrlTail: webhookUrl.slice(-8),
  })

  const mirrorWebhookUrl =
    shouldMirrorToJoel(alert)
      ? isFullQA
        ? env.SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON
        : env.SLACK_WEBHOOK_URL_JOEL_NELSON
      : undefined

  const sends: Promise<void>[] = [sendSlackWebhook(webhookUrl, payload)]

  if (mirrorWebhookUrl) {
    log("info", "Sending Slack mirror webhook for Joel Nelson", {
      callId: alert.call_id,
      webhookUrlTail: mirrorWebhookUrl.slice(-8),
    })
    sends.push(
      sendSlackWebhook(mirrorWebhookUrl, payload).catch((error) => {
        log("error", "Joel Nelson mirror Slack webhook failed", {
          callId: alert.call_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }),
    )
  }

  await Promise.all(sends)
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

interface SlackPayload {
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
  review_url: string
  enrolled_with_competitor: string
  cancellation_confirmed: string
}

interface FullQASlackPayload {
  manager_review_reason: string
  agent_email: string
  manager_email: string
  call_id: string
  sfdc_lead_id: string
  contact_name: string
  call_duration: string
  overall_tone: string
  call_outcome: string
  compliance_violations: string
  areas_for_improvement: string
  specific_coaching_points: string
  transcript_url: string
  recording_link: string
  review_url: string
}

export function buildReviewUrl(
  env: Bindings,
  callId: string,
  moduleName: string,
): string {
  const base = env.DASHBOARD_BASE_URL?.replace(/\/+$/, "")
  if (!base) return ""
  return `${base}/dashboard/alerts/${encodeURIComponent(callId)}/${encodeURIComponent(moduleName)}`
}

export function buildFullQASlackPayload(
  alert: Alert,
  managerEmail = "",
  reviewUrl = "",
): FullQASlackPayload {
  const result = alert.result as FullQAResult | undefined

  return {
    manager_review_reason: result?.call_overview?.manager_review_reason || "",
    agent_email: alert.agent_email ?? "",
    manager_email: managerEmail,
    call_id: alert.call_id,
    sfdc_lead_id: alert.sfdc_lead_id ?? "",
    contact_name: alert.contact_name ?? "",
    call_duration: formatDuration(alert.call_duration),
    overall_tone: result?.call_overview?.overall_tone || "",
    call_outcome: result?.call_overview?.call_outcome || "",
    compliance_violations: result?.compliance_scorecard?.compliance_violations?.join("\n") || "",
    areas_for_improvement: result?.coaching_recommendations?.areas_for_improvement?.join("\n") || "",
    specific_coaching_points: result?.coaching_recommendations?.specific_coaching_points?.join("\n") || "",
    transcript_url: alert.transcript_url ?? "",
    recording_link: alert.recording_link ?? "",
    review_url: reviewUrl,
  }
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || seconds < 0) return ""
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function buildSlackPayload(
  alert: Alert,
  managerEmail = "",
  reviewUrl = "",
): SlackPayload {
  const isActiveSettlements =
    alert.violation_type === VIOLATION_TYPES.ACTIVE_SETTLEMENTS
  const settlementResult = isActiveSettlements
    ? (alert.result as ActiveSettlementsResult | undefined)
    : undefined

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
    review_url: reviewUrl,
    enrolled_with_competitor: settlementResult?.enrolled_with_competitor ?? "",
    cancellation_confirmed: settlementResult?.cancellation_confirmed ?? "",
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
    case VIOLATION_TYPES.PROGRAM_EXPECTATIONS:
      return "Program expectations"
    case VIOLATION_TYPES.ACTIVE_SETTLEMENTS:
      return "Active settlements"
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
    case VIOLATION_TYPES.PROGRAM_EXPECTATIONS: {
      return (result as ProgramExpectationsResult)?.violation_reason || "Program expectations not reviewed"
    }
    case VIOLATION_TYPES.ACTIVE_SETTLEMENTS: {
      return (result as ActiveSettlementsResult)?.violation_reason || "Active settlement negotiation detected"
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
    case VIOLATION_TYPES.PROGRAM_EXPECTATIONS: {
      return (result as ProgramExpectationsResult)?.key_evidence_quote || ""
    }
    case VIOLATION_TYPES.ACTIVE_SETTLEMENTS: {
      return (result as ActiveSettlementsResult)?.key_evidence_quote || ""
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
    case VIOLATION_TYPES.PROGRAM_EXPECTATIONS: {
      const r = result as ProgramExpectationsResult
      const lines: string[] = []
      if (r?.missing_elements?.length > 0) {
        lines.push("Missing from program expectations review:")
        for (const m of r.missing_elements) {
          lines.push(`- ${m}`)
        }
      }
      const covered: string[] = []
      if (r?.phase_activation_covered) covered.push("Phase 1: Activation")
      if (r?.phase_traction_covered) covered.push("Phase 2: Traction")
      if (r?.phase_momentum_covered) covered.push("Phase 3: Momentum")
      if (r?.phase_graduation_covered) covered.push("Phase 4: Graduation")
      if (r?.credit_impact_downside_covered) covered.push("Downside: credit score decline")
      if (r?.payments_withheld_downside_covered) covered.push("Downside: payments withheld")
      if (r?.accounts_may_close_downside_covered) covered.push("Downside: accounts may close")
      if (r?.adjustment_period_downside_covered) covered.push("Downside: adjustment period")
      if (covered.length > 0) {
        if (lines.length > 0) lines.push("")
        lines.push("Covered on call:")
        for (const c of covered) lines.push(`- ${c}`)
      }
      if (r?.enrollment_evidence_quote) {
        lines.push("")
        lines.push(`Enrollment confirmed: "${r.enrollment_evidence_quote}"`)
      }
      return lines.join("\n") || "Program expectations not reviewed"
    }
    case VIOLATION_TYPES.ACTIVE_SETTLEMENTS: {
      const r = result as ActiveSettlementsResult
      const lines: string[] = []
      if (r?.mentions?.length > 0) {
        lines.push("Settlement Mentions:")
        for (const m of r.mentions) {
          lines.push(`- "${m.quote}" (${m.term_used}, ${m.speaker})`)
        }
      }
      if (r?.agent_response_quote) {
        lines.push("")
        lines.push(`Agent Response: "${r.agent_response_quote}"`)
      }
      lines.push("")
      lines.push(`Enrolled with competitor: ${r?.enrolled_with_competitor ?? "unclear"}`)
      if (r?.competitor_evidence_quote) {
        lines.push(`  Evidence: "${r.competitor_evidence_quote}"`)
      }
      lines.push(`Cancellation confirmed: ${r?.cancellation_confirmed ?? "n/a"}`)
      if (r?.cancellation_evidence_quote) {
        lines.push(`  Evidence: "${r.cancellation_evidence_quote}"`)
      }
      return lines.join("\n") || "Active settlement negotiation detected"
    }
    default:
      return ""
  }
}

async function sendSlackWebhook(
  url: string,
  payload: SlackPayload | FullQASlackPayload,
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
