import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import type { DatabaseService } from "../services/database"
import { log } from "../utils/logger"
import { workflowRetentionForEnvironment } from "./workflow-retention"

type Assignment = { partner_assignment: string | null; assignment_status: string | null } | null

/**
 * Conservative partner routing gate. Only agents whose scalar partner_assignment
 * exactly matches `partner` AND are resolved route to that partner's follow-up.
 *
 * The hourly Pipedream sync deliberately sets scalar partner_assignment only when
 * exactly one known partner label is present. Ambiguous Achieve+Beyond workers keep
 * partner_assignment null, so this scalar-only gate excludes them even if the
 * partner_assignments array contains the label.
 *
 * Three distinct failure modes (see routePartnerFollowup for per-case logging):
 *   a) assignment === null — the agent has no agent_regal_assignments record at all
 *      (logged at warn: a genuine routing gap, e.g. a real Achieve welcome call
 *      silently skipped because the agent was never synced).
 *   b) assignment_status !== "resolved" — a record exists but the sync has not
 *      resolved it to a single partner (logged at info: expected/transient).
 *   c) partner_assignment !== partner — the agent is resolved to a different
 *      partner than the one being routed (logged at info: expected).
 */
export function shouldRouteToPartner(assignment: Assignment, partner: string): boolean {
  return assignment?.partner_assignment === partner && assignment?.assignment_status === "resolved"
}

/**
 * Eligibility gate for the Achieve welcome-call QA follow-up. Chains off
 * disposition_review — the one module guaranteed to run exactly once with BOTH
 * the transcript and the completed event joined regardless of arrival order
 * (63% of calls receive transcript_available before call_completed, so a
 * full_qa-chained gate would silently skip most calls; warm_transfer only fires
 * for LegalState == "No", which excluded legal-model clients whose welcome calls
 * are just as real — field review 2026-07-21).
 *
 * Gate: enrollment disposition + a token duration floor (`achieveMinDurationSeconds`,
 * ~5 min) that filters dial legs and instant hangups. The module's own deterministic
 * segmentation gate (live welcome-rep detection) is the real filter for
 * servicing/IVR-only/non-welcome calls, so no LegalState or long-duration
 * pre-filtering is applied here.
 */
export function isAchieveWelcomeCallEligible(
  callData: EvaluateRequest,
  policy: { enrollmentDisposition: string; achieveMinDurationSeconds: number },
): { eligible: boolean; reason: string } {
  const disposition = callData.transcript.metadata.disposition
  const duration = callData.transcript.metadata.duration ?? 0
  if (disposition !== policy.enrollmentDisposition) {
    return { eligible: false, reason: `disposition '${disposition ?? ""}' != enrollment disposition` }
  }
  if (duration <= policy.achieveMinDurationSeconds) {
    return { eligible: false, reason: `duration ${duration}s <= ${policy.achieveMinDurationSeconds}s` }
  }
  return { eligible: true, reason: "eligible" }
}

/**
 * Eligibility gate for the Achieve GOTA check. The GOTA (Going Over The Agreement)
 * signing walkthrough is mandatory on every Achieve enrollment — red/Turnbull
 * legal-model states AND green/FDR states — so this follow-up chains off full_qa
 * (which fires on every transcript) rather than warm_transfer (LegalState == "No"
 * only, which would silently exclude red states). Gate on the enrollment
 * disposition + the standard enrollment duration threshold so LLM time is only
 * spent on genuine enrollment/signing calls.
 */
export function isAchieveGotaCheckEligible(
  callData: EvaluateRequest,
  policy: { enrollmentDisposition: string; enrollmentMinDurationSeconds: number },
): { eligible: boolean; reason: string } {
  const disposition = callData.transcript.metadata.disposition
  const duration = callData.transcript.metadata.duration ?? 0
  if (disposition !== policy.enrollmentDisposition) {
    return { eligible: false, reason: `disposition '${disposition ?? ""}' != enrollment disposition` }
  }
  if (duration <= policy.enrollmentMinDurationSeconds) {
    return { eligible: false, reason: `duration ${duration}s <= ${policy.enrollmentMinDurationSeconds}s` }
  }
  return { eligible: true, reason: "eligible" }
}

/**
 * After a warm_transfer eval is stored, deterministically chain a partner-specific
 * follow-up module (achieve_welcome_call_qa, budget_inputs, ...) when the completing
 * agent is resolved to `partner` in agent_regal_assignments. Keyed by agent_email
 * (callData, falling back to eavesly_calls). Idempotent on `${call_id}-${moduleName}`;
 * a duplicate ("already exists") is logged and ignored so warm_transfer retries don't
 * double-enqueue. Unexpected errors rethrow so EvaluationWorkflow logs them non-fatally.
 */
export async function routePartnerFollowup(
  env: Bindings,
  db: DatabaseService,
  callData: EvaluateRequest,
  correlationId: string,
  opts: {
    partner: string
    moduleName: string
    /** Optional per-call gate; when it returns not-eligible the follow-up is skipped. */
    eligibility?: (callData: EvaluateRequest) => { eligible: boolean; reason: string }
  },
): Promise<void> {
  const { partner, moduleName, eligibility } = opts

  // Cheap, DB-free eligibility short-circuit (e.g. Achieve's disposition + duration gate).
  if (eligibility) {
    const check = eligibility(callData)
    if (!check.eligible) {
      log("info", "Partner routing skipped: call not eligible", {
        callId: callData.call_id,
        partner,
        moduleName,
        reason: check.reason,
      })
      return
    }
  }

  let agentEmail = normalizeAgentEmail(callData.agent_email)
  if (!agentEmail) {
    const ctx = await db.getCallContext(callData.call_id)
    agentEmail = normalizeAgentEmail(ctx?.agent_email ?? undefined)
  }
  if (!agentEmail) {
    log("info", "Partner routing skipped: no agent_email", { callId: callData.call_id, partner, moduleName })
    return
  }

  const assignment = await db.getAgentRegalAssignment(agentEmail)
  if (assignment === null) {
    log("warn", "Partner routing gap: agent has no assignment record", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
    })
    return
  }
  if (assignment.assignment_status !== "resolved") {
    log("info", "Partner routing skipped: agent assignment not resolved", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      assignmentStatus: assignment.assignment_status,
    })
    return
  }
  if (assignment.partner_assignment !== partner) {
    log("info", "Partner routing skipped: agent assigned to different partner", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      actualPartnerAssignment: assignment.partner_assignment,
    })
    return
  }

  const instanceId = `${callData.call_id}-${moduleName}`
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: instanceId,
      params: { moduleName, callData, correlationId },
      retention: workflowRetentionForEnvironment(env.ENVIRONMENT),
    })
    log("info", "Chained partner follow-up", { callId: callData.call_id, partner, moduleName, instanceId })
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) {
      log("info", "Partner follow-up already enqueued; ignoring", { callId: callData.call_id, moduleName, instanceId })
      return
    }
    throw e
  }
}

function normalizeAgentEmail(agentEmail: string | undefined): string | undefined {
  const normalized = agentEmail?.trim().toLowerCase()
  return normalized || undefined
}
