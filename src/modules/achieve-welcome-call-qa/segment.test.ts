import { describe, it, expect } from "vitest"
import { segmentWelcomeCall } from "./segment"
import { achieveWelcomeCallQAModule } from "./module"
import { createMockLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import { AchieveWelcomeCallQASchema } from "../../schemas/achieve-welcome-call-qa"

// Production transcript format: "[handling agent]:", "[contact]:", "[transfer agent]:"
// labels, no timestamps. PRE_HANDOFF deliberately contains "client success advocate"
// in Pennie-side speech (the old content marker misfired on exactly this) AND a
// Pennie-side mention of "Beyond Finance" — the competitor detector must ignore
// handling-agent speech and only inspect the transfer leg.
const PRE_HANDOFF = [
  "[handling agent]: Hi, this is Jonathan with Pennie on a recorded line.",
  "[handling agent]: You mentioned you're leaving Beyond Finance — we'll set you up with Achieve today.",
  "[contact]: Yes, that's fine.",
  "[handling agent]: Great, a client success advocate will take your welcome call in a moment.",
].join("\n")

// Legit Achieve/FDR transfer leg — this is what gets graded.
const TRANSFER_LEG = [
  "[transfer agent]: Please enter the customer's 10 digit phone number.",
  "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
  "[transfer agent]: Hi. This is Julissa with Freedom Debt Relief on a recorded line.",
  "[contact]: Hi, this is Pat.",
  "[transfer agent]: Welcome to your program, Pat. This call will be recorded for quality and training purposes.",
  "[transfer agent]: First, your deposits go into your dedicated account.",
  "[transfer agent]: Second, we negotiate with each of your creditors.",
  "[transfer agent]: Third, you authorize settlements from your dashboard.",
  "[transfer agent]: Let's set up your client dashboard now.",
  "[transfer agent]: I sent you an email to get started with the app.",
  "[transfer agent]: Our customer service number is 800-655-6303.",
  "[transfer agent]: Congratulations again and have a great evening!",
].join("\n")

const FULL = `${PRE_HANDOFF}\n${TRANSFER_LEG}`

// Sanitized poor-transfer regression: one live welcome representative is followed by
// known client-enrollment IVR re-entry, then another live representative completes the
// welcome script. This intentionally contains no production identifiers or customer data.
const POOR_TRANSFER_LEG = [
  "[transfer agent]: Hello? This is Avery. Welcome call.",
  "[contact]: Hello?",
  "[transfer agent]: Thank you for calling. Please listen closely as the menu options have changed.",
  "[transfer agent]: For FDR, press 1.",
  "[transfer agent]: Thank you for calling Freedom Debt Relief's client enrollment department.",
  "[transfer agent]: My name is Riley, your client success advocate.",
  "[contact]: Hi, Riley.",
  "[transfer agent]: Welcome to your Freedom Debt Relief program. This call will be recorded.",
  "[transfer agent]: Your deposits go into a dedicated account.",
  "[transfer agent]: We negotiate with each of your creditors.",
  "[transfer agent]: You authorize settlements from your dashboard.",
  "[transfer agent]: Let us set up your client dashboard now.",
  "[transfer agent]: Your program guide explains the available tools and resources.",
  "[transfer agent]: Call customer service if you need support. Have a great day.",
].join("\n")

const POOR_TRANSFER_FULL = `${PRE_HANDOFF}\n${POOR_TRANSFER_LEG}`

// Mis-transfer to Beyond Finance (competitor): a real transfer leg, but the transfer
// agent greets/identifies as Beyond. Must never be graded.
const BEYOND_TRANSFER_LEG = [
  "[transfer agent]: Please enter the customer's 10 digit phone number.",
  "[transfer agent]: Thank you for calling Beyond Finance, your trusted partner in debt resolution.",
  "[transfer agent]: Hello. This is Giovanni with Beyond Finance on a recorded line.",
  "[contact]: Hi.",
  "[transfer agent]: Welcome. This call is recorded for quality and training purposes.",
  "[transfer agent]: First, your deposits go into your dedicated account.",
  "[transfer agent]: Second, we negotiate with each of your creditors.",
  "[transfer agent]: Third, you authorize settlements from your dashboard.",
  "[transfer agent]: Let's set up your dashboard now.",
  "[transfer agent]: I sent you an email to get started.",
  "[transfer agent]: Our customer service number is 800-000-0000.",
  "[transfer agent]: Congratulations and have a great day!",
].join("\n")

// Legit FDR leg where the customer is SWITCHING FROM Beyond — a bare "with Beyond
// Finance" mention must NOT trip the competitor skip.
const SWITCHING_TRANSFER_LEG = [
  "[transfer agent]: Please enter the customer's 10 digit phone number.",
  "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
  "[transfer agent]: Hi. This is Julissa with Freedom Debt Relief on a recorded line.",
  "[transfer agent]: Since you're enrolling with us, you'll want to cancel your program with Beyond Finance.",
  "[contact]: Okay, got it.",
  "[transfer agent]: First, your deposits go into your dedicated account.",
  "[transfer agent]: Second, we negotiate with each of your creditors.",
  "[transfer agent]: Third, you authorize settlements from your dashboard.",
  "[transfer agent]: Let's set up your client dashboard now.",
  "[transfer agent]: I sent you an email to get started with the app.",
  "[transfer agent]: Our customer service number is 800-655-6303.",
  "[transfer agent]: Congratulations again and have a great evening!",
].join("\n")

// Label-less feed (e.g. older ASR format) — content-marker path.
const LABELLESS_DISCLOSURE = [
  "1909.9s [Agent] Thank you for calling the Freedom Debt Relief disclosure line. Please enter the client's 10 digit phone number.",
  "2554.5s [Agent] Hello. Thank you for calling Welcome Call. My name is Max.",
  "2558.0s [Agent] I am here to help you get started with your program.",
].join("\n")

const mockResponse = {
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
    key_evidence_quotes: ["This call will be recorded for quality and training purposes."],
    violation: false,
    violation_reason: "",
  },
  call_overview: {
    call_outcome: "completed",
    agent_tone: "professional",
    client_engagement: "engaged",
    notes: "",
  },
  assessment_confidence: {
    score: 0.9,
    level: "high",
    rationale: "Segment is clear and complete.",
    limitations: [],
  },
}

describe("segmentWelcomeCall", () => {
  it("returns only the live welcome interaction, excluding IVR and trailing handling-agent content", () => {
    const transcript = `${FULL}\n[handling agent]: This trailing internal conversation must not be graded.`
    const seg = segmentWelcomeCall(transcript)

    expect(seg.segment_found).toBe(true)
    expect(seg.marker).toBe("live_welcome_agent")
    expect(seg.start_line).toBe(6)
    expect(seg.end_line).toBe(15)
    expect(seg.transfer_agent_lines).toBe(11)
    expect(seg.segmentation_confidence).toBe("high")
    expect(seg.used_full_transcript_fallback).toBe(false)
    expect(seg.segment).not.toContain("soft credit check")
    expect(seg.segment).not.toContain("Please enter the customer's 10 digit phone number")
    expect(seg.segment).not.toContain("trailing internal conversation")
    expect(seg.segment).toContain("Freedom Debt Relief")
  })

  it("ends before a later customer-service handoff", () => {
    const transcript = [
      FULL,
      "[transfer agent]: Before our call ends, I will transfer you to customer service for an account change.",
      "[contact]: Okay.",
      "[transfer agent]: Thank you for calling Freedom Debt Relief customer service.",
      "[transfer agent]: Let us update the payment date.",
    ].join("\n")

    const seg = segmentWelcomeCall(transcript)

    expect(seg.segment_found).toBe(true)
    expect(seg.segment).toContain("transfer you to customer service")
    expect(seg.segment).not.toContain("Thank you for calling Freedom Debt Relief customer service")
    expect(seg.segment).not.toContain("update the payment date")
  })

  it("skips grading (competitor_transfer) when the transfer leg greets as Beyond Finance", () => {
    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${BEYOND_TRANSFER_LEG}`)
    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("competitor_transfer")
    expect(seg.marker).toBe("beyond_finance_transfer")
    expect(seg.segmentation_confidence).toBe("high")
    expect(seg.transfer_agent_lines).toBe(11)
    expect(seg.segment).toBe("")
  })

  it("still grades an FDR leg when the customer is switching FROM Beyond (no false positive)", () => {
    // Handling agent mentions Beyond in PRE_HANDOFF AND a transfer line says "cancel
    // your program with Beyond Finance" — neither is a competitor greeting/self-id.
    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${SWITCHING_TRANSFER_LEG}`)
    expect(seg.segment_found).toBe(true)
    expect(seg.skip_reason).toBeNull()
    expect(seg.marker).toBe("live_welcome_agent")
    expect(seg.segment).toContain("cancel your program with Beyond Finance")
  })

  it("skips grading when an IVR-only transfer exceeds the old line-count threshold", () => {
    const ivrOnlyLeg = [
      "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
      "[transfer agent]: Press 1 for English. Press 2 for Spanish.",
      "[transfer agent]: Please enter the client's 10 digit phone number.",
      "[transfer agent]: You entered the client's phone number.",
      "[transfer agent]: Now let's walk through the details of your program.",
      "[transfer agent]: This debt resolution plan negotiates settlements.",
      "[transfer agent]: Deposits are held in a dedicated account.",
      "[transfer agent]: Negotiators work with enrolled creditors.",
      "[transfer agent]: Creditors may continue collection activity.",
      "[transfer agent]: Fees are earned after a settlement payment.",
      "[transfer agent]: You may cancel without penalty.",
      "[transfer agent]: Welcome, and congratulations on this step.",
      "[transfer agent]: Your confirmation number is 123456.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${ivrOnlyLeg}`)

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("no_live_welcome_agent")
    expect(seg.transfer_agent_lines).toBe(13)
    expect(seg.segment).toBe("")
  })

  it("does not mistake an IVR role announcement for a live representative", () => {
    const ivrQueueLeg = [
      "[transfer agent]: Thank you for calling Freedom Debt Relief's client enrollment department.",
      "[transfer agent]: Please wait while I connect you with a client advocate.",
      "[contact]: Okay.",
      "[transfer agent]: Your estimated wait time is five minutes.",
      "[transfer agent]: Please continue to hold for the next available representative.",
      "[transfer agent]: Your call is important to us.",
      "[transfer agent]: Please remain on the line.",
      "[transfer agent]: All representatives are assisting other clients.",
      "[transfer agent]: Your estimated wait time is four minutes.",
      "[transfer agent]: Please continue to hold.",
      "[transfer agent]: We appreciate your patience.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${ivrQueueLeg}`)

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("no_live_welcome_agent")
  })

  it("skips a live FDR customer-service call that is not a welcome call", () => {
    const serviceLeg = [
      "[transfer agent]: Thank you for calling Freedom Debt Relief customer service.",
      "[transfer agent]: If you are currently a client and have a question, press 3.",
      "[transfer agent]: Please enter the phone number associated with your account.",
      "[transfer agent]: For security, enter the last four digits of the client's SSN.",
      "[transfer agent]: Thank you. We verified the account.",
      "[transfer agent]: My name is Isabelle. Who do I have the pleasure of speaking with?",
      "[handling agent]: I am calling to add another account for an existing client.",
      "[transfer agent]: The client can upload that through the app.",
      "[handling agent]: Can they see the updated deposit first?",
      "[transfer agent]: The new DocuSign will show any payment change.",
      "[transfer agent]: The client can call customer service with questions.",
      "[handling agent]: Thank you for your help.",
      "[transfer agent]: You are welcome. Have a good day.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${serviceLeg}`)

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("non_welcome_transfer")
    expect(seg.segment).toBe("")
  })

  it("grades a poor but real live welcome interaction instead of hiding script failures", () => {
    const interruptedWelcomeLeg = [
      "[transfer agent]: Thank you for calling Freedom Debt Relief's client enrollment department.",
      "[transfer agent]: Thank you for calling Welcome Call. My name is Ana.",
      "[contact]: Hi, Ana.",
      "[transfer agent]: How are you today?",
      "[contact]: I cannot stay on the call and need to reschedule.",
      "[transfer agent]: Understood. We will call you tomorrow.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${interruptedWelcomeLeg}`)

    expect(seg.segment_found).toBe(true)
    expect(seg.skip_reason).toBeNull()
    expect(seg.marker).toBe("live_welcome_agent")
  })

  it("grades a welcome call that proceeds after an earlier status blocker clears", () => {
    const recoveredWelcomeLeg = [
      "[transfer agent]: Thank you for calling Welcome Call. My name is Natalie.",
      "[handling agent]: Is the agreement available now?",
      "[transfer agent]: It was waiting for acknowledgment earlier, but it is complete now.",
      "[contact]: Great.",
      "[transfer agent]: Welcome to your Freedom Debt Relief program.",
      "[transfer agent]: Your deposits will go into a dedicated account.",
      "[contact]: Understood.",
      "[transfer agent]: Let us continue with your dashboard setup.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${recoveredWelcomeLeg}`)

    expect(seg.segment_found).toBe(true)
    expect(seg.skip_reason).toBeNull()
  })

  it("does not treat explicitly resolved status history as an active blocker", () => {
    const resolvedHistoryLeg = [
      "[transfer agent]: Thank you for calling Welcome Call. My name is Ana.",
      "[contact]: Hi, Ana.",
      "[transfer agent]: Welcome to your Freedom Debt Relief program.",
      "[transfer agent]: The agreement was waiting for acknowledgment earlier, but it is complete now.",
      "[contact]: Great.",
      "[transfer agent]: Let us continue with the rest of your setup.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${resolvedHistoryLeg}`)

    expect(seg.segment_found).toBe(true)
    expect(seg.skip_reason).toBeNull()
  })

  it("skips when a live Welcome Call representative joins but the welcome call never starts", () => {
    const blockedWelcomeLeg = [
      "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
      "[transfer agent]: The disclosure recording is complete.",
      "[transfer agent]: Thank you for calling Freedom Debt Relief's client enrollment department.",
      "[transfer agent]: Good afternoon. Thank you for calling Welcome Call. My name is Natalie.",
      "[handling agent]: The client is on the line.",
      "[transfer agent]: May I have the client's phone number?",
      "[handling agent]: I just provided it.",
      "[transfer agent]: The agreement is still waiting for acknowledgment.",
      "[contact]: I clicked finish just now.",
      "[transfer agent]: It is not allowing me to proceed with the welcome call.",
      "[handling agent]: This state has a three-day waiting period.",
      "[transfer agent]: I understand. Please call back once the status updates.",
      "[transfer agent]: You both have a great day.",
    ].join("\n")

    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${blockedWelcomeLeg}`)

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("welcome_call_not_started")
    expect(seg.segment).toBe("")
  })

  it("skips grading when the transfer leg is too short (handoff attempted, advocate never joined)", () => {
    const shortLeg = [
      "[transfer agent]: Please enter the customer's 10 digit phone number.",
      "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
    ].join("\n")
    const seg = segmentWelcomeCall(`${PRE_HANDOFF}\n${shortLeg}`)
    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("transfer_leg_too_short")
    expect(seg.transfer_agent_lines).toBe(2)
    expect(seg.segment).toBe("")
  })

  it("does not grade a label-less transcript containing only the disclosure IVR", () => {
    const seg = segmentWelcomeCall(
      "IVR: Thank you for calling the Freedom Debt Relief disclosure line.\n" +
      "IVR: Please enter the client's 10 digit phone number.\n" +
      "IVR: Welcome, and congratulations. Your confirmation number is 123456.",
    )

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("no_live_welcome_agent")
    expect(seg.segment).toBe("")
  })

  it("skips a live label-less welcome call because it has no reliable end boundary", () => {
    const seg = segmentWelcomeCall(`Agent: pre-handoff enrollment stuff\n${LABELLESS_DISCLOSURE}`)

    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("unbounded_label_less")
    expect(seg.marker).toBe("live_welcome_agent")
    expect(seg.segment).toBe("")
  })

  it("skips a label-less transcript whose only marker-ish line greets as Beyond Finance", () => {
    const seg = segmentWelcomeCall(
      "Agent: pre-handoff enrollment stuff\nRep: Thank you for calling Beyond Finance, your trusted partner."
    )
    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("competitor_transfer")
    expect(seg.marker).toBe("beyond_finance_transfer")
    expect(seg.segment).toBe("")
  })

  it("matches broadened content markers: customer's phone prompt and debt resolution branding", () => {
    const a = segmentWelcomeCall("Agent: intro\nIVR: Please enter the customer's 10 digit phone number.")
    expect(a.marker).toBe("fdr_disclosure_phone_prompt")
    const b = segmentWelcomeCall("Agent: intro\nIVR: Thank you for calling the debt resolution disclosure line.")
    expect(b.marker).toBe("fdr_disclosure_line_start")
    const d = segmentWelcomeCall(
      "Agent: intro\nRep: Hi, this is Uber, welcome call specialist.\nRep: I will help you get started with your program.",
    )
    expect(d.marker).toBe("live_welcome_agent")
  })

  it("does NOT segment on client success advocate or coordinator-handoff phrasing (deleted misfiring markers)", () => {
    const t = "Agent: our client success advocate team is great.\nAgent: I have Max on the line to help you."
    const seg = segmentWelcomeCall(t)
    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("no_transfer_leg")
  })

  it("returns no segment (never the full transcript) when nothing matches", () => {
    const seg = segmentWelcomeCall(PRE_HANDOFF)
    expect(seg.segment_found).toBe(false)
    expect(seg.skip_reason).toBe("no_transfer_leg")
    expect(seg.segment).toBe("")
    expect(seg.marker).toBeNull()
    expect(seg.used_full_transcript_fallback).toBe(false)
  })
})

describe("achieveWelcomeCallQAModule.evaluate", () => {
  it("sends only the post-handoff segment to the LLM", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    await achieveWelcomeCallQAModule.evaluate(FULL, request, llm as any)

    const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
    expect(userPrompt).not.toContain("soft credit check")
    expect(userPrompt).toContain("Freedom Debt Relief")
    expect(userPrompt).toContain("Do NOT give credit")
  })

  it("stamps transcript_segment metadata and partner/script version", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(FULL, request, llm as any)
    const r = result.result as any

    expect(r.partner_id).toBe("achieve")
    expect(r.script_version).toBe("fdr_wholesale_db_pilot_v1")
    expect(r.transcript_segment).toMatchObject({
      segment_type: "fdr_disclosure_and_welcome_call",
      marker: "live_welcome_agent",
      start_line: 6,
      end_line: 15,
      segmentation_confidence: "high",
      segment_found: true,
      skip_reason: null,
      transfer_agent_lines: 11,
      used_full_transcript_fallback: false,
    })
    expect(r.transfer_experience).toMatchObject({
      poor_transfer: false,
      reasons: [],
      ivr_reentry_lines: [],
      detection_version: "achieve_poor_transfer_v1",
    })
    expect(AchieveWelcomeCallQASchema.safeParse(r).success).toBe(true)
  })

  it("skips the LLM entirely and stores a deterministic result when no segment is found", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(PRE_HANDOFF, request, llm as any)

    expect(llm.getStructuredResponse).not.toHaveBeenCalled()
    expect(result.has_violation).toBe(false)
    expect(result.violation_type).toBeNull()
    const r = result.result as any
    expect(r.grading_skipped).toBe(true)
    expect(r.skip_reason).toBe("no_transfer_leg")
    expect(r.partner_id).toBe("achieve")
    expect(r.transcript_segment.segment_found).toBe(false)
    expect(r.script_adherence).toBeUndefined()
    expect(r.transfer_experience).toBeUndefined()
  })

  it("skips the LLM for a competitor (Beyond Finance) mis-transfer", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(`${PRE_HANDOFF}\n${BEYOND_TRANSFER_LEG}`, request, llm as any)

    expect(llm.getStructuredResponse).not.toHaveBeenCalled()
    expect(result.has_violation).toBe(false)
    const r = result.result as any
    expect(r.grading_skipped).toBe(true)
    expect(r.skip_reason).toBe("competitor_transfer")
    expect(r.transcript_segment.segment_found).toBe(false)
    expect(r.script_adherence).toBeUndefined()
  })

  it("persists poor transfer as a violation while preserving full script adherence", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()

    const result = await achieveWelcomeCallQAModule.evaluate(POOR_TRANSFER_FULL, request, llm as any)
    const r = result.result as any

    expect(result.has_violation).toBe(true)
    expect(result.violation_type).toBe("achieve_welcome_call")
    expect(r.script_adherence.overall_script_adherence).toBe("full")
    expect(r.script_adherence.violation).toBe(false)
    expect(r.script_adherence.violation_reason).toBe("")
    expect(r.transfer_experience.poor_transfer).toBe(true)
    expect(r.transfer_experience.reasons).toEqual([
      "live_rep_then_ivr_reentry_then_live_rep",
    ])
  })

  it("overwrites model-supplied transfer experience with deterministic analysis", async () => {
    const llm = createMockLLM({
      ...mockResponse,
      transfer_experience: {
        poor_transfer: false,
        reasons: [],
        ivr_reentry_lines: [],
        agent_attempts: [],
        evidence: [],
        detection_version: "achieve_poor_transfer_v1",
      },
    })
    const request = createEvaluateRequest()

    const result = await achieveWelcomeCallQAModule.evaluate(POOR_TRANSFER_FULL, request, llm as any)
    const transferExperience = (result.result as any).transfer_experience

    expect(transferExperience.poor_transfer).toBe(true)
    expect(transferExperience.ivr_reentry_lines).toEqual([6, 7, 8])
    expect(transferExperience.agent_attempts).toHaveLength(2)
  })

  it("drops evidence quotes that are not verbatim from the graded segment", async () => {
    const llm = createMockLLM({
      ...mockResponse,
      script_adherence: {
        ...mockResponse.script_adherence,
        key_evidence_quotes: [
          "your deposits go into your   Dedicated Account.", // in segment (whitespace/case differ)
          "I ran your soft credit check earlier.", // pre-handoff / fabricated
          "   ", // whitespace-only: normalizes to "" (a substring of everything) — must be dropped
          "", // empty string: same trap
        ],
      },
    })
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(FULL, request, llm as any)
    const quotes = (result.result as any).script_adherence.key_evidence_quotes
    expect(quotes).toEqual(["your deposits go into your   Dedicated Account."])
  })
})
