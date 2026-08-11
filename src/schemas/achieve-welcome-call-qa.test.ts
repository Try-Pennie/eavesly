import { describe, expect, it } from "vitest"
import { AchieveWelcomeCallQAModelResponseSchema } from "./achieve-welcome-call-qa"

const modelResponse = {
  script_adherence: {
    greeting_and_identity_completed: true,
    recording_disclosure_provided: true,
    company_credibility_covered: true,
    call_agenda_provided: true,
    dedicated_account_deposits_explained: true,
    creditor_negotiation_explained: true,
    settlement_authorizations_explained: true,
    dashboard_account_setup_covered: true,
    tools_and_resources_covered: true,
    closing_and_support_provided: true,
    overall_script_adherence: "full",
    missing_elements: [],
    key_evidence_quotes: [],
    violation: false,
    violation_reason: "",
  },
  agent_identity_check: {
    correctly_identified_as_fdr: true,
    issue_quote: null,
  },
  call_overview: {
    call_outcome: "completed",
    agent_tone: "professional",
    client_engagement: "engaged",
    delivery_naturalness: "natural",
    handoff_quality: "smooth",
    notes: "",
  },
  assessment_confidence: {
    score: 0.9,
    level: "high",
    rationale: "Clear segment.",
    limitations: [],
  },
}

describe("AchieveWelcomeCallQAModelResponseSchema", () => {
  it("accepts the model-owned fields without deterministic metadata", () => {
    expect(AchieveWelcomeCallQAModelResponseSchema.safeParse(modelResponse).success).toBe(true)
  })

  it("requires the model-owned agent identity check", () => {
    const { agent_identity_check: _omitted, ...withoutIdentity } = modelResponse
    expect(AchieveWelcomeCallQAModelResponseSchema.safeParse(withoutIdentity).success).toBe(false)
  })
})
