import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import type { DatabaseService } from "../services/database"
import {
  segmentWelcomeCall,
  type SegmentSkipReason,
  type SegmentationConfidence,
  type WelcomeCallSegment,
} from "../modules/achieve-welcome-call-qa/segment"
import { log } from "../utils/logger"
import { workflowRetentionForEnvironment } from "./workflow-retention"

type Assignment = { partner_assignment: string | null; assignment_status: string | null } | null

type WelcomeCallSegmentEvidence = {
  readonly found: boolean
  readonly skipReason: SegmentSkipReason | null
  readonly confidence: SegmentationConfidence
  readonly marker: string | null
}

/** Structured Achieve welcome-call eligibility used by the routing shell. */
export type AchieveWelcomeCallEligibility =
  | {
      readonly eligible: true
      readonly reason: "strong_transcript_evidence" | "metadata_eligible"
      readonly assignment: "override" | "require_match"
      readonly segment: WelcomeCallSegmentEvidence
    }
  | {
      readonly eligible: false
      readonly reason: "disposition_ineligible" | "duration_ineligible"
      readonly assignment: "require_match"
      readonly segment: WelcomeCallSegmentEvidence
    }

const TURNBULL_PENDING_DISPOSITION = "1.3B - Turnbull Pending"

type FollowupEligibility = {
  readonly eligible: boolean
  readonly reason: string
  readonly assignment?: "override" | "require_match"
}

/** Structured outcome emitted by partner follow-up routing. */
export type PartnerRoutingResult =
  | {
      readonly status: "routed"
      readonly reason: "assignment_override" | "assignment_match"
      readonly eligibilityReason?: string
      readonly instanceId: string
    }
  | {
      readonly status: "skipped"
      readonly reason:
        | "call_ineligible"
        | "agent_email_missing"
        | "assignment_missing"
        | "assignment_unresolved"
        | "assignment_mismatch"
        | "already_enqueued"
      readonly eligibilityReason?: string
    }

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
 * A gradeable result from the production segmenter is authoritative and may
 * override stale disposition, duration, and assignment metadata. Otherwise the
 * metadata path requires an enrollment/Turnbull-Pending disposition plus a token
 * duration floor (`achieveMinDurationSeconds`, ~5 min). Metadata eligibility still
 * routes failed handoffs so the QA module can persist a deterministic skip, while
 * competitor and unbounded/no-evidence calls without eligible metadata fail closed.
 */
export function isAchieveWelcomeCallEligible(
  callData: EvaluateRequest,
  policy: { enrollmentDisposition: string; achieveMinDurationSeconds: number },
): AchieveWelcomeCallEligibility {
  return isAchieveWelcomeCallEligibleWithSegment(
    callData,
    policy,
    segmentWelcomeCall(callData.transcript.transcript),
  )
}

/** Apply Achieve eligibility policy to one already-computed production segment. */
export function isAchieveWelcomeCallEligibleWithSegment(
  callData: EvaluateRequest,
  policy: { enrollmentDisposition: string; achieveMinDurationSeconds: number },
  segment: WelcomeCallSegment,
): AchieveWelcomeCallEligibility {
  const segmentEvidence: WelcomeCallSegmentEvidence = {
    found: segment.segment_found,
    skipReason: segment.skip_reason,
    confidence: segment.segmentation_confidence,
    marker: segment.marker,
  }

  // segment_found is the production segmenter's gradeable, partner-bounded
  // contract. It is authoritative when mutable routing metadata is stale.
  if (segment.segment_found) {
    return {
      eligible: true,
      reason: "strong_transcript_evidence",
      assignment: "override",
      segment: segmentEvidence,
    }
  }

  const disposition = callData.transcript.metadata.disposition
  const metadataDispositionEligible =
    disposition === policy.enrollmentDisposition || disposition === TURNBULL_PENDING_DISPOSITION
  if (!metadataDispositionEligible) {
    return {
      eligible: false,
      reason: "disposition_ineligible",
      assignment: "require_match",
      segment: segmentEvidence,
    }
  }

  const duration = callData.transcript.metadata.duration ?? 0
  if (duration <= policy.achieveMinDurationSeconds) {
    return {
      eligible: false,
      reason: "duration_ineligible",
      assignment: "require_match",
      segment: segmentEvidence,
    }
  }

  return {
    eligible: true,
    reason: "metadata_eligible",
    assignment: "require_match",
    segment: segmentEvidence,
  }
}

/**
 * Eligibility gate for the Achieve combined PSC + GOTA check. The GOTA (Going
 * Over The Agreement) signing walkthrough is mandatory on every Achieve
 * enrollment — red/Turnbull legal-model states AND green/FDR states — so this
 * follow-up chains off disposition_review, the one module guaranteed to run with
 * transcript + completed-event data (and lead_context) joined regardless of
 * webhook arrival order. It cannot chain from warm_transfer (LegalState == "No"
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
 * Deterministically chain a partner-specific follow-up module. The default path
 * requires the completing agent to be resolved to `partner`; a caller-owned
 * eligibility decision may explicitly override assignment when it has authoritative
 * bounded evidence. Keyed by agent_email (callData, falling back to eavesly_calls).
 * Idempotent on `${call_id}-${moduleName}`; a duplicate is logged and returned as a
 * structured skip. Unexpected errors rethrow for the workflow boundary to report.
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
    eligibility?: (callData: EvaluateRequest) => FollowupEligibility
  },
): Promise<PartnerRoutingResult> {
  const { partner, moduleName, eligibility } = opts

  // Cheap, DB-free eligibility short-circuit (e.g. Achieve's transcript/metadata gate).
  const eligibilityCheck = eligibility?.(callData)
  if (eligibilityCheck && !eligibilityCheck.eligible) {
    log("info", "Partner routing skipped: call not eligible", {
      callId: callData.call_id,
      partner,
      moduleName,
      routingStatus: "skipped",
      routingReason: "call_ineligible",
      eligibilityReason: eligibilityCheck.reason,
    })
    return {
      status: "skipped",
      reason: "call_ineligible",
      eligibilityReason: eligibilityCheck.reason,
    }
  }

  const assignmentOverridden = eligibilityCheck?.assignment === "override"
  if (assignmentOverridden) {
    return await enqueuePartnerFollowup(
      env,
      callData,
      correlationId,
      partner,
      moduleName,
      "assignment_override",
      eligibilityCheck.reason,
    )
  }

  let agentEmail = normalizeAgentEmail(callData.agent_email)
  if (!agentEmail) {
    const ctx = await db.getCallContext(callData.call_id)
    agentEmail = normalizeAgentEmail(ctx?.agent_email ?? undefined)
  }
  if (!agentEmail) {
    log("info", "Partner routing skipped: no agent_email", {
      callId: callData.call_id,
      partner,
      moduleName,
      routingStatus: "skipped",
      routingReason: "agent_email_missing",
    })
    return { status: "skipped", reason: "agent_email_missing" }
  }

  const assignment = await db.getAgentRegalAssignment(agentEmail)
  if (assignment === null) {
    log("warn", "Partner routing gap: agent has no assignment record", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      routingStatus: "skipped",
      routingReason: "assignment_missing",
    })
    return { status: "skipped", reason: "assignment_missing" }
  }
  if (assignment.assignment_status !== "resolved") {
    log("info", "Partner routing skipped: agent assignment not resolved", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      assignmentStatus: assignment.assignment_status,
      routingStatus: "skipped",
      routingReason: "assignment_unresolved",
    })
    return { status: "skipped", reason: "assignment_unresolved" }
  }
  if (assignment.partner_assignment !== partner) {
    log("info", "Partner routing skipped: agent assigned to different partner", {
      callId: callData.call_id,
      agentEmail,
      partner,
      moduleName,
      actualPartnerAssignment: assignment.partner_assignment,
      routingStatus: "skipped",
      routingReason: "assignment_mismatch",
    })
    return { status: "skipped", reason: "assignment_mismatch" }
  }

  return await enqueuePartnerFollowup(
    env,
    callData,
    correlationId,
    partner,
    moduleName,
    "assignment_match",
    eligibilityCheck?.reason,
  )
}

async function enqueuePartnerFollowup(
  env: Bindings,
  callData: EvaluateRequest,
  correlationId: string,
  partner: string,
  moduleName: string,
  routingReason: "assignment_override" | "assignment_match",
  eligibilityReason?: string,
): Promise<PartnerRoutingResult> {
  const instanceId = `${callData.call_id}-${moduleName}`
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: instanceId,
      params: { moduleName, callData, correlationId },
      retention: workflowRetentionForEnvironment(env.ENVIRONMENT),
    })
    log("info", "Chained partner follow-up", {
      callId: callData.call_id,
      partner,
      moduleName,
      instanceId,
      routingStatus: "routed",
      routingReason,
      eligibilityReason,
    })
    return { status: "routed", reason: routingReason, eligibilityReason, instanceId }
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) {
      log("info", "Partner follow-up already enqueued; ignoring", {
        callId: callData.call_id,
        moduleName,
        instanceId,
        routingStatus: "skipped",
        routingReason: "already_enqueued",
      })
      return { status: "skipped", reason: "already_enqueued" }
    }
    throw e
  }
}

function normalizeAgentEmail(agentEmail: string | undefined): string | undefined {
  const normalized = agentEmail?.trim().toLowerCase()
  return normalized || undefined
}
