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
}

export const DEFAULT_RESOLVER_POLICY: ResolverPolicy = {
  enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
  enrollmentMinDurationSeconds: 1200,
  excludedCampaignFriendlyIds: [],
  warmTransferLegalStateValue: "No",
  collectionsMinBalance: 1,
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
}

/**
 * Convert a transcript_available event into an EvaluateRequest-compatible call
 * data object (the shape the existing evaluate/* modules consume). Shadow-only in
 * this PR — nothing evaluates it yet.
 */
export function transcriptEventToCallData(e: TranscriptAvailableEvent): EvaluateRequest {
  return {
    call_id: e.regal_task_id,
    regal_task_id: e.regal_task_id,
    agent_id: e.agent_email ?? "",
    transcript: {
      transcript: e.transcript ?? "",
      metadata: {
        duration: e.recording_duration ?? 0,
        timestamp: e.originalTimestamp ?? "",
      },
    },
    agent_email: e.agent_email,
    contact_name: e.contact_name,
    contact_phone: e.contact_phone,
    recording_link: e.recording_link,
    call_summary: e.call_summary,
    transcript_url: e.transcript_url,
  }
}

/**
 * Deterministic resolver: joinedEvents + policy -> ModuleTriggerPlan.
 *
 * Shadow-only in this PR (no workflows are triggered). Records which QA modules
 * the backend *would* run so we can shadow-compare against the current Regal
 * journey before simplifying it.
 */
export function buildModuleTriggerPlan(
  joined: JoinedRegalEvents,
  policy: ResolverPolicy,
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
  }
}
