import { describe, it, expect } from "vitest"
import { segmentWelcomeCall } from "./segment"
import { achieveWelcomeCallQAModule } from "./module"
import { createMockLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"

// A transcript with pre-handoff Pennie enrollment/disclosure followed by the
// actual FDR welcome-call coordinator joining.
const PRE_HANDOFF = [
  "Agent: Hi, this is Jonathan with Pennie on a recorded line.",
  "Agent: Before we run a soft credit check, is it okay if we do that?",
  "Client: Yes, that's fine.",
  "Agent: Great, I'm going to enroll you in the program now.",
].join("\n")

const POST_HANDOFF = [
  "Coordinator: Thank you for calling, this is your welcome call. My name is Max, your client success advocate.",
  "Coordinator: I'll help you log in to your client dashboard today.",
  "Client: Sounds good.",
].join("\n")

const FULL = `${PRE_HANDOFF}\n${POST_HANDOFF}`

const mockResponse = {
  script_adherence: {
    welcome_greeting_completed: true,
    program_overview_covered: true,
    timeline_expectations_covered: true,
    payment_process_explained: true,
    client_communication_process_covered: true,
    next_steps_provided: true,
    overall_script_adherence: "full",
    missing_elements: [],
    key_evidence_quotes: ["Thank you for calling, this is your welcome call."],
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
  it("starts the segment at the coordinator handoff marker", () => {
    const seg = segmentWelcomeCall(FULL)
    expect(seg.used_full_transcript_fallback).toBe(false)
    expect(seg.marker).toBe("welcome_call_greeting")
    expect(seg.segmentation_confidence).toBe("high")
    // pre-handoff content excluded, post-handoff retained
    expect(seg.segment).not.toContain("soft credit check")
    expect(seg.segment).not.toContain("enroll you in the program")
    expect(seg.segment).toContain("welcome call")
    expect(seg.segment).toContain("client success advocate")
    expect(seg.start_line).toBe(4)
  })

  it("matches the client success advocate marker without a greeting", () => {
    const t = "Agent: enrollment stuff\nCoordinator: My name is Dana, your client success advocate."
    const seg = segmentWelcomeCall(t)
    expect(seg.marker).toBe("client_success_advocate")
    expect(seg.segment).not.toContain("enrollment stuff")
  })

  it("matches the dashboard app marker", () => {
    const t = "Agent: disclosure\nCoordinator: Let's open the Freedom Debt Relief client dashboard app."
    const seg = segmentWelcomeCall(t)
    expect(seg.marker).toBe("fdr_dashboard_app")
    expect(seg.used_full_transcript_fallback).toBe(false)
  })

  it("matches a coordinator handoff line with medium confidence", () => {
    const t = "Agent: enrollment\nAgent: I have Max on the line to help you.\nMax: Hello!"
    const seg = segmentWelcomeCall(t)
    expect(seg.marker).toBe("coordinator_handoff")
    expect(seg.segmentation_confidence).toBe("medium")
  })

  it("falls back to the full transcript with low confidence when no marker is found", () => {
    const seg = segmentWelcomeCall(PRE_HANDOFF)
    expect(seg.used_full_transcript_fallback).toBe(true)
    expect(seg.marker).toBeNull()
    expect(seg.segmentation_confidence).toBe("low")
    expect(seg.segment).toBe(PRE_HANDOFF)
    expect(seg.start_line).toBe(0)
  })
})

describe("achieveWelcomeCallQAModule.evaluate segmentation", () => {
  it("sends only the post-handoff segment to the LLM", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    await achieveWelcomeCallQAModule.evaluate(FULL, request, llm as any)

    const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
    expect(userPrompt).not.toContain("soft credit check")
    expect(userPrompt).not.toContain("enroll you in the program")
    expect(userPrompt).toContain("client success advocate")
    // preamble tells the model not to infer from earlier content
    expect(userPrompt).toContain("Do NOT give credit")
  })

  it("stamps transcript_segment metadata and partner/script version", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(FULL, request, llm as any)
    const r = result.result as any

    expect(r.partner_id).toBe("achieve")
    expect(r.script_version).toBe("fdr_wholesale_db_pilot_v0")
    expect(r.transcript_segment).toMatchObject({
      segment_type: "fdr_welcome_call_coordinator",
      marker: "welcome_call_greeting",
      segmentation_confidence: "high",
      segmentation_score: 0.95,
      used_full_transcript_fallback: false,
    })
    expect(r.assessment_confidence.level).toBe("high")
  })

  it("flags fallback in metadata when no handoff marker is present", async () => {
    const llm = createMockLLM(mockResponse)
    const request = createEvaluateRequest()
    const result = await achieveWelcomeCallQAModule.evaluate(PRE_HANDOFF, request, llm as any)
    const r = result.result as any
    expect(r.transcript_segment.used_full_transcript_fallback).toBe(true)
    expect(r.transcript_segment.marker).toBeNull()

    const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
    expect(userPrompt).toContain("fallback")
  })
})
