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
 */
export function shouldRouteToPartner(assignment: Assignment, partner: string): boolean {
  return assignment?.partner_assignment === partner && assignment?.assignment_status === "resolved"
}

/**
 * Eligibility gate for the Achieve welcome-call QA follow-up. Achieve should only
 * score genuine post-enrollment welcome calls, so it requires the enrollment
 * disposition AND a call at least `achieveMinDurationSeconds` long — short calls on
 * the same disposition are servicing/escalation/pre-enrollment noise.
 *
 * LegalState == "No" is already enforced upstream by the warm_transfer gate this
 * follow-up chains off (and is not carried on callData), so it is not re-checked here.
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
  if (!shouldRouteToPartner(assignment, partner)) {
    log("info", "Partner routing skipped: agent not resolved to partner", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      partnerAssignment: assignment?.partner_assignment ?? null,
      assignmentStatus: assignment?.assignment_status ?? null,
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
