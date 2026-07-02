import { describe, it, expect } from "vitest"
import {
  buildModuleTriggerPlan,
  transcriptEventToCallData,
  parseResolverPolicyRow,
  DEFAULT_RESOLVER_POLICY,
  type JoinedRegalEvents,
} from "./regal-events"
import { MODULE_NAMES } from "../modules/constants"
import type { TranscriptAvailableEvent, CallCompletedEvent } from "../schemas/regal-events"

function transcript(overrides: Partial<TranscriptAvailableEvent> = {}): TranscriptAvailableEvent {
  return {
    event_type: "transcript_available",
    regal_task_id: "task-1",
    transcript: "hi",
    ...overrides,
  }
}

function completed(overrides: Partial<CallCompletedEvent> = {}): CallCompletedEvent {
  return {
    event_type: "call_completed",
    regal_task_id: "task-1",
    disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
    recording_duration: 1500,
    ...overrides,
  }
}

function triggered(joined: JoinedRegalEvents) {
  return new Set(buildModuleTriggerPlan(joined, DEFAULT_RESOLVER_POLICY).triggered)
}

describe("buildModuleTriggerPlan", () => {
  it("enrolled >20m + LegalState No + collections >1 triggers all expected modules", () => {
    const t = triggered({
      transcript: transcript({ customProperties: { LegalState: "No", collectionsBalance: 2 } }),
      completed: completed(),
    })
    expect(t).toEqual(
      new Set([
        MODULE_NAMES.FULL_QA,
        MODULE_NAMES.DISPOSITION_REVIEW,
        MODULE_NAMES.PROGRAM_EXPECTATIONS,
        MODULE_NAMES.WARM_TRANSFER,
        MODULE_NAMES.LITIGATION_CHECK,
      ]),
    )
  })

  it("non-enrolled disposition does not trigger enrollment modules", () => {
    const t = triggered({
      transcript: transcript({ customProperties: { LegalState: "No", collectionsBalance: 2 } }),
      completed: completed({ disposition: "2.1 - Not Interested" }),
    })
    expect(t.has(MODULE_NAMES.PROGRAM_EXPECTATIONS)).toBe(false)
    expect(t.has(MODULE_NAMES.WARM_TRANSFER)).toBe(false)
    expect(t.has(MODULE_NAMES.LITIGATION_CHECK)).toBe(false)
    // full_qa + disposition_review still fire.
    expect(t.has(MODULE_NAMES.FULL_QA)).toBe(true)
    expect(t.has(MODULE_NAMES.DISPOSITION_REVIEW)).toBe(true)
  })

  it("duration <= 20m does not trigger enrollment modules", () => {
    const t = triggered({
      transcript: transcript({ customProperties: { LegalState: "No", collectionsBalance: 2 } }),
      completed: completed({ recording_duration: 1200 }),
    })
    expect(t.has(MODULE_NAMES.PROGRAM_EXPECTATIONS)).toBe(false)
    expect(t.has(MODULE_NAMES.WARM_TRANSFER)).toBe(false)
    expect(t.has(MODULE_NAMES.LITIGATION_CHECK)).toBe(false)
  })

  it("enrolled but LegalState != No skips warm_transfer; collections<=1 skips litigation_check", () => {
    const t = triggered({
      transcript: transcript({ customProperties: { LegalState: "Yes", collectionsBalance: 1 } }),
      completed: completed(),
    })
    expect(t.has(MODULE_NAMES.PROGRAM_EXPECTATIONS)).toBe(true)
    expect(t.has(MODULE_NAMES.WARM_TRANSFER)).toBe(false)
    expect(t.has(MODULE_NAMES.LITIGATION_CHECK)).toBe(false)
  })

  it("missing completed event yields only transcript/full_qa shadow state", () => {
    const plan = buildModuleTriggerPlan({ transcript: transcript() }, DEFAULT_RESOLVER_POLICY)
    expect(plan.enrolled).toBe(false)
    expect(plan.triggered).toEqual([MODULE_NAMES.FULL_QA])
  })

  it("completion timeout triggers disposition_review without a completed event", () => {
    const t = triggered({ transcript: transcript(), completionTimedOut: true })
    expect(t.has(MODULE_NAMES.DISPOSITION_REVIEW)).toBe(true)
  })

  it("excluded campaign blocks enrollment", () => {
    const policy = { ...DEFAULT_RESOLVER_POLICY, excludedCampaignFriendlyIds: ["445"] }
    const plan = buildModuleTriggerPlan(
      { transcript: transcript(), completed: completed({ campaign_friendly_id: "445" }) },
      policy,
    )
    expect(plan.enrolled).toBe(false)
  })

  it("threads the policy version into the plan (null when omitted)", () => {
    const withVersion = buildModuleTriggerPlan({ transcript: transcript() }, DEFAULT_RESOLVER_POLICY, 7)
    expect(withVersion.policy_version).toBe(7)

    const noVersion = buildModuleTriggerPlan({ transcript: transcript() }, DEFAULT_RESOLVER_POLICY)
    expect(noVersion.policy_version).toBeNull()
  })
})

describe("parseResolverPolicyRow", () => {
  const validPolicy = {
    enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
    enrollmentMinDurationSeconds: 900,
    excludedCampaignFriendlyIds: ["445"],
    warmTransferLegalStateValue: "No",
    collectionsMinBalance: 0,
    achieveMinDurationSeconds: 2400,
  }

  it("returns the parsed policy and row id for a valid row", () => {
    const active = parseResolverPolicyRow({ id: 42, policy_json: validPolicy })
    expect(active.policyVersion).toBe(42)
    expect(active.policy).toEqual(validPolicy)
  })

  it("defaults achieveMinDurationSeconds for legacy rows written before the field existed", () => {
    const { achieveMinDurationSeconds, ...legacy } = validPolicy
    const active = parseResolverPolicyRow({ id: 43, policy_json: legacy })
    expect(active.policyVersion).toBe(43)
    expect(active.policy.achieveMinDurationSeconds).toBe(1800)
    expect(active.policy.enrollmentMinDurationSeconds).toBe(900)
  })

  it("falls back to DEFAULT_RESOLVER_POLICY with null version when the row is absent", () => {
    const active = parseResolverPolicyRow(null)
    expect(active.policyVersion).toBeNull()
    expect(active.policy).toEqual(DEFAULT_RESOLVER_POLICY)
  })

  it("falls back to DEFAULT_RESOLVER_POLICY with null version when policy_json is malformed", () => {
    const active = parseResolverPolicyRow({
      id: 9,
      policy_json: { enrollmentMinDurationSeconds: -1, excludedCampaignFriendlyIds: "nope" },
    })
    expect(active.policyVersion).toBeNull()
    expect(active.policy).toEqual(DEFAULT_RESOLVER_POLICY)
  })
})

describe("transcriptEventToCallData", () => {
  it("maps a transcript event onto EvaluateRequest shape", () => {
    const data = transcriptEventToCallData(
      transcript({
        agent_email: "a@b.com",
        recording_link: "https://rec/1",
        recording_duration: 900,
        transcript_url: "https://t/1",
        originalTimestamp: "2026-01-01T00:00:00Z",
        contact_phone: "+15550000000",
      }),
    )
    expect(data.call_id).toBe("task-1")
    expect(data.regal_task_id).toBe("task-1")
    expect(data.agent_id).toBe("a@b.com")
    expect(data.recording_link).toBe("https://rec/1")
    expect(data.transcript.metadata.duration).toBe(900)
    expect(data.transcript.metadata.timestamp).toBe("2026-01-01T00:00:00Z")
  })

  it("enriches callData with task-scoped completed-event metadata when present", () => {
    const data = transcriptEventToCallData(
      transcript({ agent_email: undefined, recording_duration: undefined }),
      completed({
        agent_email: "completed-agent@trypennie.com",
        contact_phone: "+155****1111",
        recording_duration: 1501,
        talk_time: 1300,
        disposition: "1.4 - Converted/Won > END CAMPAIGNS",
        campaign_name: "End Campaigns",
        originalTimestamp: "2026-01-02T00:00:00Z",
      }),
    )

    expect(data.agent_id).toBe("completed-agent@trypennie.com")
    expect(data.contact_phone).toBe("+155****1111")
    expect(data.transcript.metadata.duration).toBe(1501)
    expect(data.transcript.metadata.talk_time).toBe(1300)
    expect(data.transcript.metadata.disposition).toBe("1.4 - Converted/Won > END CAMPAIGNS")
    expect(data.transcript.metadata.campaign_name).toBe("End Campaigns")
    expect(data.transcript.metadata.timestamp).toBe("2026-01-02T00:00:00Z")
  })
})
