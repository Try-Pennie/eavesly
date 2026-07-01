import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import type { DatabaseService } from "../services/database"
import { MODULE_NAMES } from "../modules/constants"
import { log } from "../utils/logger"

/**
 * Conservative Achieve routing gate. Only agents explicitly resolved to Achieve
 * route to the welcome-call QA. Ambiguous rows (scalar partner_assignment null,
 * even if partner_assignments contains "achieve") and non-resolved rows do NOT
 * route.
 */
export function shouldRouteToAchieve(
  assignment: { partner_assignment: string | null; assignment_status: string | null } | null,
): boolean {
  return assignment?.partner_assignment === "achieve" && assignment?.assignment_status === "resolved"
}

/**
 * After a warm_transfer eval is stored, deterministically chain the existing
 * achieve_welcome_call_qa module when the completing agent is assigned to
 * Achieve (resolved) in agent_regal_assignments. Keyed by agent_email
 * (callData, falling back to eavesly_calls). Idempotent on
 * `${call_id}-achieve_welcome_call_qa`; a duplicate ("already exists") is
 * logged and ignored so warm_transfer retries don't double-enqueue.
 */
export async function routeAchieveWelcomeCallQA(
  env: Bindings,
  db: DatabaseService,
  callData: EvaluateRequest,
  correlationId: string,
): Promise<void> {
  let agentEmail = normalizeAgentEmail(callData.agent_email)
  if (!agentEmail) {
    const ctx = await db.getCallContext(callData.call_id)
    agentEmail = normalizeAgentEmail(ctx?.agent_email ?? undefined)
  }
  if (!agentEmail) {
    log("info", "Achieve routing skipped: no agent_email", { callId: callData.call_id })
    return
  }

  const assignment = await db.getAgentRegalAssignment(agentEmail)
  // The hourly Pipedream sync deliberately sets scalar partner_assignment only
  // when exactly one known partner label is present. Ambiguous Achieve+Beyond
  // workers keep partner_assignment null, so the scalar-only gate below excludes
  // them even if partner_assignments contains "achieve".
  if (!shouldRouteToAchieve(assignment)) {
    log("info", "Achieve routing skipped: agent not resolved to Achieve", {
      callId: callData.call_id,
      agentEmail,
      partnerAssignment: assignment?.partner_assignment ?? null,
      assignmentStatus: assignment?.assignment_status ?? null,
    })
    return
  }

  const instanceId = `${callData.call_id}-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: instanceId,
      params: { moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA, callData, correlationId },
    })
    log("info", "Chained achieve_welcome_call_qa", { callId: callData.call_id, instanceId })
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) {
      log("info", "achieve_welcome_call_qa already enqueued; ignoring", { callId: callData.call_id, instanceId })
      return
    }
    throw e
  }
}

function normalizeAgentEmail(agentEmail: string | undefined): string | undefined {
  const normalized = agentEmail?.trim().toLowerCase()
  return normalized || undefined
}
