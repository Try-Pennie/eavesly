import { describe, it, expect } from "vitest"
import {
  buildModuleTriggerPlan,
  transcriptEventToCallData,
  callCompletedEventToCallRow,
  regalEpochToISO,
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

  it("surfaces when strong welcome evidence is blocked on the missing disposition-review prerequisite", () => {
    const welcomeTranscript = [
      "[handling agent]: I will connect you to the welcome team now.",
      "[transfer agent]: My name is Sam with Freedom Debt Relief.",
      "[contact]: Yes, I am ready.",
      "[transfer agent]: Welcome to your program. Let us get you started.",
    ].join("\n")

    const plan = buildModuleTriggerPlan(
      { transcript: transcript({ transcript: welcomeTranscript }) },
      DEFAULT_RESOLVER_POLICY,
    )

    expect(plan.decisions).toContainEqual({
      module: MODULE_NAMES.DISPOSITION_REVIEW,
      trigger: false,
      reason: "strong_welcome_evidence_awaiting_completed_event",
    })
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
    expect(active.policy.achieveMinDurationSeconds).toBe(300)
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
        customProperties: { LegalState: "No", clientState: "CA", collectionsBalance: 2 },
      }),
    )
    expect(data.call_id).toBe("task-1")
    expect(data.regal_task_id).toBe("task-1")
    expect(data.agent_id).toBe("a@b.com")
    expect(data.recording_link).toBe("https://rec/1")
    expect(data.transcript.metadata.duration).toBe(900)
    expect(data.transcript.metadata.timestamp).toBe("2026-01-01T00:00:00Z")
    expect(data.lead_context).toEqual({ legal_state: "No", client_state: "CA" })
  })

  it("falls back to completed-event customProperties for lead context", () => {
    const data = transcriptEventToCallData(
      transcript({ customProperties: undefined }),
      completed({ customProperties: { LegalState: "Yes", clientState: "NY", collectionsBalance: 3 } }),
    )
    expect(data.lead_context).toEqual({ legal_state: "Yes", client_state: "NY" })
  })

  it("omits lead_context when neither event carries lead state", () => {
    const data = transcriptEventToCallData(transcript({ customProperties: undefined }), completed())
    expect(data.lead_context).toBeUndefined()
  })

  it("enriches callData with task-scoped completed-event metadata when present", () => {
    const data = transcriptEventToCallData(
      transcript({ agent_email: undefined, recording_duration: undefined }),
      completed({
        agent_email: "completed-agent@trypennie.com",
        sfdc_lead_id: "00Q5f000009zzzz",
        contact_phone: "+155****1111",
        recording_duration: 1501,
        talk_time: 1300,
        disposition: "1.4 - Converted/Won > END CAMPAIGNS",
        campaign_name: "End Campaigns",
        originalTimestamp: "2026-01-02T00:00:00Z",
      }),
    )

    expect(data.agent_id).toBe("completed-agent@trypennie.com")
    expect(data.sfdc_lead_id).toBe("00Q5f000009zzzz")
    expect(data.contact_phone).toBe("+155****1111")
    expect(data.transcript.metadata.duration).toBe(1501)
    expect(data.transcript.metadata.talk_time).toBe(1300)
    expect(data.transcript.metadata.disposition).toBe("1.4 - Converted/Won > END CAMPAIGNS")
    expect(data.transcript.metadata.campaign_name).toBe("End Campaigns")
    expect(data.transcript.metadata.timestamp).toBe("2026-01-02T00:00:00Z")
  })
})

describe("regalEpochToISO", () => {
  it("treats the value as epoch seconds (not millis)", () => {
    // 1783539045s -> 2026, not 1970 (which is what a millis reading would give)
    expect(regalEpochToISO("1783539045")).toBe(new Date(1783539045 * 1000).toISOString())
    expect(regalEpochToISO("1783539045")?.startsWith("2026-07-08")).toBe(true)
    expect(regalEpochToISO(1783539045)?.startsWith("2026-07-08")).toBe(true)
  })

  it("returns null for empty/missing/invalid", () => {
    expect(regalEpochToISO("")).toBeNull()
    expect(regalEpochToISO(undefined)).toBeNull()
    expect(regalEpochToISO(null)).toBeNull()
    expect(regalEpochToISO(0)).toBeNull()
    expect(regalEpochToISO("nope")).toBeNull()
  })
})

describe("callCompletedEventToCallRow", () => {
  it("maps completed-event fields and converts epoch-second timestamps", () => {
    const row = callCompletedEventToCallRow(
      completed({
        regal_task_id: "WTabc",
        agent_email: "a@b.com",
        sfdc_lead_id: "00Q5f000001abcd",
        disposition: "1.1A - No Show - First Call",
        campaign_name: "Camp",
        contact_phone: "+15550001111",
        talk_time: 2401,
        handle_time: 2555,
        wrapup_time: 154,
        started_at: "1783539045",
        ended_at: 1783541446,
        completed_at: "1783541600",
      }),
    )
    expect(row.call_id).toBe("WTabc")
    expect(row.agent_email).toBe("a@b.com")
    expect(row.sfdc_lead_id).toBe("00Q5f000001abcd")
    expect(row.disposition).toBe("1.1A - No Show - First Call")
    expect(row.campaign_name).toBe("Camp")
    expect(row.talk_time).toBe(2401)
    expect(row.started_at?.startsWith("2026-07-08")).toBe(true)
    expect(row.ended_at?.startsWith("2026-07-08")).toBe(true)
    // id + created_at are set at write time, never mapped from the payload
    expect(row).not.toHaveProperty("id")
    expect(row).not.toHaveProperty("created_at")
  })

  it("nulls empty agent_email and empty/missing timestamps", () => {
    const row = callCompletedEventToCallRow(
      completed({ agent_email: "", started_at: "", ended_at: undefined }),
    )
    expect(row.agent_email).toBeNull()
    expect(row.started_at).toBeNull()
    expect(row.ended_at).toBeNull()
  })
})
