import { describe, it, expect } from "vitest"
import { segmentWelcomeCall } from "./segment"
import { achieveWelcomeCallQAModule } from "./module"
import { createMockLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"

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
  it("segments at the first [transfer agent] line, ignoring look-alike Pennie content", () => {
    const seg = segmentWelcomeCall(FULL)
    expect(seg.segment_found).toBe(true)
    expect(seg.marker).toBe("transfer_agent_label")
    expect(seg.start_line).toBe(4)
    expect(seg.transfer_agent_lines).toBe(11)
    expect(seg.segmentation_confidence).toBe("high")
    expect(seg.used_full_transcript_fallback).toBe(false)
    expect(seg.segment).not.toContain("soft credit check")
    expect(seg.segment).toContain("Freedom Debt Relief")
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
    expect(seg.marker).toBe("transfer_agent_label")
    expect(seg.segment).toContain("cancel your program with Beyond Finance")
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

  it("falls back to content markers only when the transcript has no speaker labels", () => {
    const seg = segmentWelcomeCall(`Agent: pre-handoff enrollment stuff\n${LABELLESS_DISCLOSURE}`)
    expect(seg.segment_found).toBe(true)
    expect(seg.marker).toBe("fdr_disclosure_line_start")
    expect(seg.start_line).toBe(1)
    expect(seg.segment).not.toContain("enrollment stuff")
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
    const d = segmentWelcomeCall("Agent: intro\nRep: Hi, this is Uber, welcome call specialist.")
    expect(d.marker).toBe("welcome_call_specialist")
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
      marker: "transfer_agent_label",
      segmentation_confidence: "high",
      segment_found: true,
      skip_reason: null,
      transfer_agent_lines: 11,
      used_full_transcript_fallback: false,
    })
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
