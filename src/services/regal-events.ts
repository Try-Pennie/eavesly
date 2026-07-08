import { z } from "zod"
import type { EvaluateRequest } from "../schemas/requests"
import type {
  TranscriptAvailableEvent,
  CallCompletedEvent,
} from "../schemas/regal-events"
import { MODULE_NAMES } from "../modules/constants"

export type RegalCallEvent = TranscriptAvailableEvent | CallCompletedEvent

/** Events joined by regal_task_id — the resolver's input. */
export interface JoinedRegalEvents {
  transcript?: TranscriptAvailableEvent
  completed?: CallCompletedEvent
  /** Set when the completed event never arrived and a timeout was declared. */
  completionTimedOut?: boolean
}

/**
 * Resolver policy. A future QVV admin panel will edit these, so the decision
 * logic reads them as data (joinedEvents + policy -> plan) rather than hardcoding
 * conditionals. v1 values match Noah's confirmed rules.
 */
export interface ResolverPolicy {
  enrollmentDisposition: string
  enrollmentMinDurationSeconds: number
  excludedCampaignFriendlyIds: string[]
  warmTransferLegalStateValue: string
  collectionsMinBalance: number
  /**
   * Achieve welcome-call QA (chained off warm_transfer) only scores calls at least
   * this long. Genuine FDR welcome calls run ~45 min; shorter calls on the same
   * enrollment disposition are servicing/escalation/pre-enrollment noise.
   */
  achieveMinDurationSeconds: number
}

export const DEFAULT_RESOLVER_POLICY: ResolverPolicy = {
  enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
  enrollmentMinDurationSeconds: 1200,
  excludedCampaignFriendlyIds: [],
  warmTransferLegalStateValue: "No",
  collectionsMinBalance: 1,
  achieveMinDurationSeconds: 1800,
}

/** Shape of a policy stored in eavesly_resolver_policies.policy_json. */
export const ResolverPolicySchema = z.object({
  enrollmentDisposition: z.string().min(1),
  enrollmentMinDurationSeconds: z.number().int().positive(),
  excludedCampaignFriendlyIds: z.array(z.string()),
  warmTransferLegalStateValue: z.string().min(1),
  collectionsMinBalance: z.number().min(0),
  // Defaulted so existing policy rows (written before this field) stay valid and
  // don't fall back to the whole DEFAULT_RESOLVER_POLICY on parse.
  achieveMinDurationSeconds: z.number().int().positive().default(1800),
})

export interface ActiveResolverPolicy {
  policy: ResolverPolicy
  /** eavesly_resolver_policies.id, or null when falling back to the code default. */
  policyVersion: number | null
}

/**
 * Pure parse of a policy table row (or absence of one) into the active policy.
 * Any missing/invalid row falls back to DEFAULT_RESOLVER_POLICY — a bad config
 * row must never stop QA triggering. Kept pure for unit testing.
 */
export function parseResolverPolicyRow(
  row: { id: number; policy_json: unknown } | null,
): ActiveResolverPolicy {
  if (!row) return { policy: DEFAULT_RESOLVER_POLICY, policyVersion: null }
  const parsed = ResolverPolicySchema.safeParse(row.policy_json)
  if (!parsed.success) return { policy: DEFAULT_RESOLVER_POLICY, policyVersion: null }
  return { policy: parsed.data, policyVersion: row.id }
}

export interface ModuleDecision {
  module: string
  trigger: boolean
  reason: string
}

export interface ModuleTriggerPlan {
  regal_task_id: string
  enrolled: boolean
  decisions: ModuleDecision[]
  /** Convenience: module names where trigger === true. */
  triggered: string[]
  /** eavesly_resolver_policies.id the plan was built from, or null for the code default. */
  policy_version?: number | null
}

/**
 * Convert a transcript_available event into an EvaluateRequest-compatible call
 * data object (the shape the existing evaluate/* modules consume). This is the
 * callData the events endpoints pass to EVALUATION_WORKFLOW.create.
 */
export function transcriptEventToCallData(
  e: TranscriptAvailableEvent,
  completed?: CallCompletedEvent,
): EvaluateRequest {
  return {
    call_id: e.regal_task_id,
    regal_task_id: e.regal_task_id,
    agent_id: e.agent_email ?? completed?.agent_email ?? "",
    transcript: {
      transcript: e.transcript ?? "",
      metadata: {
        duration: e.recording_duration ?? completed?.recording_duration ?? 0,
        timestamp: e.originalTimestamp ?? completed?.originalTimestamp ?? "",
        talk_time: completed?.talk_time,
        disposition: completed?.disposition,
        campaign_name: completed?.campaign_name,
      },
    },
    agent_email: e.agent_email ?? completed?.agent_email,
    contact_name: e.contact_name,
    contact_phone: e.contact_phone ?? completed?.contact_phone,
    recording_link: e.recording_link,
    call_summary: e.call_summary,
    transcript_url: e.transcript_url,
  }
}

/**
 * Convert a Regal timestamp field into an ISO string, or null when absent.
 * Regal sends started_at/ended_at/completed_at as unix epoch *seconds* (e.g.
 * "1783539045"), sometimes stringified and sometimes an empty string.
 * ponytail: assumes seconds, not millis — the payloads are ~1.7e9 (2026), a
 * millis reading would land in 1970. Revisit only if Regal changes the unit.
 */
export function regalEpochToISO(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

/**
 * Project a call_completed event onto an eavesly_calls row. The Regal-webhook QA
 * path writes eavesly_regal_call_events + eavesly_transcription_qa but not
 * eavesly_calls, which is the table the manager dashboard reads — so without this
 * the dashboard shows 0 calls even while QA + Slack alerts run (incident
 * 2026-07-01, when ingestion cut over from the retired SFDC/Pipedream sync that
 * used to populate eavesly_calls). sfdc_lead_id / agent_full_name / direction /
 * campaign_id are not in the Regal payload and stay null (they came from SFDC).
 * `id` is a generated identity and `created_at` is set at write time, so neither
 * is mapped here.
 */
export function callCompletedEventToCallRow(e: CallCompletedEvent) {
  return {
    call_id: e.regal_task_id,
    agent_email: e.agent_email || null,
    disposition: e.disposition ?? null,
    campaign_name: e.campaign_name ?? null,
    contact_phone: e.contact_phone ?? null,
    conversation_happened: e.conversation_happened ?? null,
    talk_time: e.talk_time ?? null,
    handle_time: e.handle_time ?? null,
    wrapup_time: e.wrapup_time ?? null,
    started_at: regalEpochToISO(e.started_at),
    ended_at: regalEpochToISO(e.ended_at),
    completed_at: regalEpochToISO(e.completed_at),
  }
}

/**
 * Deterministic resolver: joinedEvents + policy -> ModuleTriggerPlan.
 *
 * The events endpoints launch EVALUATION_WORKFLOW for every module in `triggered`
 * (once a transcript is available). The plan is also stored for shadow comparison
 * against the current Regal journey while the cutover is validated.
 */
export function buildModuleTriggerPlan(
  joined: JoinedRegalEvents,
  policy: ResolverPolicy,
  policyVersion?: number | null,
): ModuleTriggerPlan {
  const { transcript, completed } = joined
  const regal_task_id = transcript?.regal_task_id ?? completed?.regal_task_id ?? ""
  const decisions: ModuleDecision[] = []

  // full_qa: fires as soon as a transcript is available.
  decisions.push(
    transcript
      ? { module: MODULE_NAMES.FULL_QA, trigger: true, reason: "transcript available" }
      : { module: MODULE_NAMES.FULL_QA, trigger: false, reason: "no transcript event" },
  )

  // disposition_review: fires when the call completed (or a completion timeout
  // was declared, so a mis-disposition can still be reviewed).
  if (completed) {
    decisions.push({ module: MODULE_NAMES.DISPOSITION_REVIEW, trigger: true, reason: "call completed" })
  } else if (joined.completionTimedOut) {
    decisions.push({ module: MODULE_NAMES.DISPOSITION_REVIEW, trigger: true, reason: "completion timed out" })
  } else {
    decisions.push({ module: MODULE_NAMES.DISPOSITION_REVIEW, trigger: false, reason: "no completed event" })
  }

  // Enrollment gate: exact disposition + duration > threshold + campaign allowed.
  const disposition = completed?.disposition
  const duration = transcript?.recording_duration ?? completed?.recording_duration ?? 0
  const dispositionMatch = disposition === policy.enrollmentDisposition
  const durationMatch = duration > policy.enrollmentMinDurationSeconds
  const campaignExcluded =
    completed?.campaign_friendly_id !== undefined &&
    policy.excludedCampaignFriendlyIds.includes(completed.campaign_friendly_id)
  const enrolled = dispositionMatch && durationMatch && !campaignExcluded

  const enrollmentReason = enrolled
    ? "enrolled"
    : !completed
      ? "no completed event"
      : !dispositionMatch
        ? `disposition '${disposition ?? ""}' != enrollment disposition`
        : !durationMatch
          ? `duration ${duration}s <= ${policy.enrollmentMinDurationSeconds}s`
          : "campaign excluded"

  // Enrollment-gated QA modules.
  decisions.push({ module: MODULE_NAMES.PROGRAM_EXPECTATIONS, trigger: enrolled, reason: enrollmentReason })

  // warm_transfer: enrolled AND LegalState == policy value. In the current Regal
  // journey, LegalState == "No" routes to warm-transfer; the collections check
  // runs afterward on both legal/non-legal paths.
  const legalState = transcript?.customProperties?.LegalState
  const warmTransfer = enrolled && legalState === policy.warmTransferLegalStateValue
  decisions.push({
    module: MODULE_NAMES.WARM_TRANSFER,
    trigger: warmTransfer,
    reason: !enrolled ? enrollmentReason : warmTransfer ? `LegalState == '${policy.warmTransferLegalStateValue}'` : `LegalState '${legalState ?? ""}' != '${policy.warmTransferLegalStateValue}'`,
  })

  // litigation_check: enrolled AND collectionsBalance > threshold.
  const balance = transcript?.customProperties?.collectionsBalance ?? 0
  const collections = enrolled && balance > policy.collectionsMinBalance
  decisions.push({
    module: MODULE_NAMES.LITIGATION_CHECK,
    trigger: collections,
    reason: !enrolled ? enrollmentReason : collections ? `collectionsBalance ${balance} > ${policy.collectionsMinBalance}` : `collectionsBalance ${balance} <= ${policy.collectionsMinBalance}`,
  })

  return {
    regal_task_id,
    enrolled,
    decisions,
    triggered: decisions.filter((d) => d.trigger).map((d) => d.module),
    policy_version: policyVersion ?? null,
  }
}
