import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import type { DatabaseService } from "../services/database"
import { log } from "../utils/logger"

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
  opts: { partner: string; moduleName: string },
): Promise<void> {
  const { partner, moduleName } = opts

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
