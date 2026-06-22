import { describe, it, expect } from "vitest"
import { categorizeDisposition, buildDispositionReview } from "./logic"
import type { DispositionAnalysis } from "../../schemas/disposition-review"

function analysis(overrides: Partial<DispositionAnalysis> = {}): DispositionAnalysis {
  return {
    suggested_disposition: "Not Interested",
    disposition_matches_transcript: false,
    confidence: 0.9,
    conversation_happened: "yes",
    evidence: [{ speaker: "contact", quote: "I'm not interested", rationale: "explicit decline" }],
    reasoning_summary: "Contact declined.",
    alternative_candidates: [],
    ...overrides,
  }
}

describe("categorizeDisposition", () => {
  it("classifies AI-eligible dispositions", () => {
    expect(categorizeDisposition("Not Interested")).toBe("ai_eligible")
    expect(categorizeDisposition("Do Not Contact")).toBe("ai_eligible")
    expect(categorizeDisposition("Transfer to Agent")).toBe("ai_eligible")
    expect(categorizeDisposition("Reminder Confirmation - No Action")).toBe("ai_eligible")
  })

  it("is case- and whitespace-insensitive for AI-eligible values", () => {
    expect(categorizeDisposition("  not interested  ")).toBe("ai_eligible")
  })

  it("classifies numbered dispositions as manager_restricted", () => {
    expect(categorizeDisposition("1.1B - Redistribute")).toBe("manager_restricted")
    expect(categorizeDisposition("1.1 - Keep In Automation")).toBe("manager_restricted")
    expect(categorizeDisposition("1.9 - Something")).toBe("manager_restricted")
    expect(categorizeDisposition("2.0 - Nurture Lead")).toBe("manager_restricted")
  })

  it("classifies named manager dispositions as manager_restricted", () => {
    expect(categorizeDisposition("Close - No Action")).toBe("manager_restricted")
  })

  it("classifies END CAMPAIGNS outcomes as end_campaign", () => {
    expect(categorizeDisposition("1.4 - Converted/Won > END CAMPAIGNS")).toBe("end_campaign")
    expect(categorizeDisposition("1.5 - Not Interested > END CAMPAIGNS")).toBe("end_campaign")
  })

  it("classifies unknown/null dispositions as unknown", () => {
    expect(categorizeDisposition("Some Brand New Value")).toBe("unknown")
    expect(categorizeDisposition(null)).toBe("unknown")
    expect(categorizeDisposition("")).toBe("unknown")
  })
})

describe("buildDispositionReview", () => {
  it("uses the server-provided current disposition, not the LLM", () => {
    const result = buildDispositionReview(analysis(), "Interested")
    expect(result.current_disposition).toBe("Interested")
  })

  it("never allows auto-update, even for high-confidence AI-eligible suggestions", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "Not Interested", confidence: 0.99 }),
      "Interested",
    )
    expect(result.permission.can_auto_update).toBe(false)
  })

  it("recommends no_change and no violation when disposition matches", () => {
    const result = buildDispositionReview(
      analysis({ disposition_matches_transcript: true, suggested_disposition: "Not Interested" }),
      "Not Interested",
    )
    expect(result.recommended_action).toBe("no_change")
    expect(result.permission.requires_human_review).toBe(false)
  })

  // The objective gate fires when the model's conversation_happened ("yes" by
  // default in this helper) contradicts the current disposition's canonical
  // value (passed as the 3rd arg).
  it("surfaces manager-restricted mismatches for human review with a violation", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "2.0 - Nurture Lead" }),
      "Interested",
      "no",
    )
    expect(result.recommended_action).toBe("surface_for_review")
    expect(result.permission.category).toBe("manager_restricted")
    expect(result.permission.requires_human_review).toBe(true)
  })

  it("surfaces END CAMPAIGNS mismatches for human review", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "1.5 - Not Interested > END CAMPAIGNS" }),
      "Interested",
      "no",
    )
    expect(result.recommended_action).toBe("surface_for_review")
    expect(result.permission.requires_human_review).toBe(true)
    expect(result.permission.category).toBe("end_campaign")
  })

  it("flags AI-eligible high-confidence mismatches as future-auto-update candidates (still a violation)", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "Not Interested", confidence: 0.95 }),
      "Interested",
      "no",
    )
    expect(result.recommended_action).toBe("eligible_for_future_auto_update")
    expect(result.permission.requires_human_review).toBe(true)
    expect(result.permission.category).toBe("ai_eligible")
    expect(result.permission.can_auto_update).toBe(false)
  })

  it("surfaces AI-eligible mismatches with modest confidence for review rather than future-auto", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "Not Interested", confidence: 0.6 }),
      "Interested",
      "no",
    )
    expect(result.recommended_action).toBe("surface_for_review")
    expect(result.permission.requires_human_review).toBe(true)
  })

  it("does NOT flag a subjective relabel when the conversation status agrees (the noisy bucket)", () => {
    // Model would relabel a real conversation, but agrees a conversation happened
    // — canonical "yes" matches model "yes", so no objective conflict.
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "Not Interested", confidence: 0.95 }),
      "Interested",
      "yes",
    )
    expect(result.recommended_action).toBe("no_change")
    expect(result.permission.requires_human_review).toBe(false)
  })

  it("does NOT flag when the current disposition has no canonical conversation value", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: "Not Interested", confidence: 0.95 }),
      "Interested",
      null,
    )
    expect(result.recommended_action).toBe("no_change")
    expect(result.permission.requires_human_review).toBe(false)
  })

  it("returns insufficient_evidence when the conversation is unclear", () => {
    const result = buildDispositionReview(
      analysis({ conversation_happened: "unclear", confidence: 0.9 }),
      "Interested",
    )
    expect(result.recommended_action).toBe("insufficient_evidence")
    expect(result.permission.requires_human_review).toBe(false)
  })

  it("returns insufficient_evidence when confidence is below the minimum", () => {
    const result = buildDispositionReview(
      analysis({ confidence: 0.2 }),
      "Interested",
    )
    expect(result.recommended_action).toBe("insufficient_evidence")
    expect(result.permission.requires_human_review).toBe(false)
  })

  it("returns insufficient_evidence when an objective mismatch has no suggested disposition", () => {
    const result = buildDispositionReview(
      analysis({ suggested_disposition: null, confidence: 0.9 }),
      "Interested",
      "no",
    )
    expect(result.recommended_action).toBe("insufficient_evidence")
    expect(result.permission.requires_human_review).toBe(false)
  })

  it("passes the LLM analysis fields through unchanged", () => {
    const a = analysis()
    const result = buildDispositionReview(a, "Interested")
    expect(result.suggested_disposition).toBe(a.suggested_disposition)
    expect(result.confidence).toBe(a.confidence)
    expect(result.conversation_happened).toBe(a.conversation_happened)
    expect(result.evidence).toEqual(a.evidence)
    expect(result.reasoning_summary).toBe(a.reasoning_summary)
    expect(result.alternative_candidates).toEqual(a.alternative_candidates)
  })
})
