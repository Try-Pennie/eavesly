import { describe, expect, it } from "vitest"
import { segmentWelcomeCall } from "./segment"
import { analyzeTransferExperience } from "./transfer-experience"

const PRE_HANDOFF = [
  "[handling agent]: I will connect you to the welcome team now.",
  "[contact]: Okay.",
].join("\n")

function analyze(transcript: string) {
  const segment = segmentWelcomeCall(transcript)
  expect(segment.segment_found).toBe(true)
  return analyzeTransferExperience(segment)
}

describe("analyzeTransferExperience", () => {
  it("flags a failed live attempt followed by known IVR re-entry and a later live welcome representative", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: Hello? This is Avery. Welcome call.",
      "[contact]: Hello?",
      "[transfer agent]: Thank you for calling. Please listen closely as the menu options have changed.",
      "[transfer agent]: For FDR, press 1.",
      "[transfer agent]: Thank you for calling Freedom Debt Relief's client enrollment department.",
      "[transfer agent]: My name is Riley, your client success advocate.",
      "[contact]: Hi, Riley.",
      "[transfer agent]: Welcome to your Freedom Debt Relief program. This call is recorded.",
      "[transfer agent]: Your deposits go into a dedicated account.",
      "[transfer agent]: We negotiate with each creditor.",
      "[transfer agent]: You authorize settlements from your dashboard.",
      "[transfer agent]: Let us set up your client dashboard.",
      "[transfer agent]: Your program guide explains the available tools and resources.",
      "[transfer agent]: Call customer service if you need support. Have a great day.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(true)
    expect(result.reasons).toEqual(["live_rep_then_ivr_reentry_then_live_rep"])
    expect(result.ivr_reentry_lines).toEqual([4, 5, 6])
    expect(result.agent_attempts).toEqual([
      { line: 2, name_asr: "Avery", quote: "This is Avery" },
      { line: 7, name_asr: "Riley", quote: "My name is Riley" },
    ])
    expect(result.evidence).toEqual([
      { line: 2, quote: "This is Avery" },
      { line: 4, quote: "menu options have changed" },
      { line: 5, quote: "For FDR, press 1" },
      { line: 6, quote: "Freedom Debt Relief's client enrollment department" },
      { line: 7, quote: "My name is Riley" },
    ])
    expect(result.detection_version).toBe("achieve_poor_transfer_v1")
  })

  it("does not require distinct ASR-derived names across live attempts", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Avery with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: The menu options have changed. For FDR, press 1.",
      "[transfer agent]: My name is Avery with Freedom Debt Relief.",
      "[transfer agent]: We negotiate with each creditor and you authorize settlements.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(true)
    expect(result.agent_attempts.map(({ name_asr }) => name_asr)).toEqual(["Avery", "Avery"])
  })

  it("uses the bounded three-line live-representative fallback after IVR re-entry", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Kai with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: Please listen closely because the menu options have changed.",
      "[transfer agent]: Thank you for calling Welcome Call.",
      "[transfer agent]: My name is Quinn.",
      "[contact]: Hi, Quinn.",
      "[transfer agent]: We negotiate with each creditor and you authorize settlements.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(true)
    expect(result.agent_attempts).toEqual([
      { line: 2, name_asr: "Kai", quote: "My name is Kai" },
      { line: 7, name_asr: "Quinn", quote: "My name is Quinn" },
    ])
  })

  it("does not flag IVR re-entry unless a later live welcome representative joins", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Skyler with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: Please listen closely because the menu options have changed.",
      "[transfer agent]: For client enrollment, press 2.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ivr_reentry_lines).toEqual([5, 6])
    expect(result.agent_attempts).toHaveLength(1)
  })

  it("ignores normal IVR before the first live welcome representative", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
      "[transfer agent]: Please enter the client's 10 digit phone number.",
      "[transfer agent]: For FDR, press 1.",
      "[transfer agent]: Hi, my name is Jordan with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program.",
      "[transfer agent]: Your deposits go into a dedicated account.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ivr_reentry_lines).toEqual([])
    expect(result.agent_attempts).toEqual([
      { line: 5, name_asr: "Jordan", quote: "my name is Jordan" },
    ])
  })

  it("does not classify a live Welcome Call greeting as IVR", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Rowan with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: Thank you for calling Welcome Call. My name is Rowan. Please press 1 when ready.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.ivr_reentry_lines).toEqual([])
  })

  it("does not flag a repeated introduction from the same agent without IVR", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: This is Avery with Freedom Debt Relief.",
      "[contact]: Hello, I can hear you now.",
      "[transfer agent]: This is Avery with Freedom Debt Relief. I was introducing myself again.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.ivr_reentry_lines).toEqual([])
    expect(result.agent_attempts).toHaveLength(1)
  })

  it("does not treat a live standalone press instruction as IVR before a colleague joins", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Casey with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: Please press 1 to continue and confirm your dashboard setup.",
      "[transfer agent]: My colleague Ellis will finish the welcome call with you.",
      "[transfer agent]: My name is Ellis, your client success advocate.",
      "[transfer agent]: We negotiate with your creditors and you authorize settlements.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ivr_reentry_lines).toEqual([])
  })

  it("does not flag a colleague handoff between two named agents without IVR", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Casey with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: My colleague Morgan will finish the welcome call with you.",
      "[transfer agent]: My name is Morgan, your client success advocate.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ivr_reentry_lines).toEqual([])
  })

  it("does not treat a hold queue followed by the live agent resuming as IVR re-entry", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Taylor with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Please hold while I review your account.",
      "[transfer agent]: Your estimated wait time is two minutes.",
      "[transfer agent]: To receive a callback instead of continuing to hold, press 1.",
      "[transfer agent]: This is Taylor with Freedom Debt Relief. Thank you for holding.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
    ].join("\n")

    const result = analyze(transcript)

    expect(result.poor_transfer).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ivr_reentry_lines).toEqual([])
  })

  it("ignores a customer-service transfer after the bounded welcome segment", () => {
    const transcript = [
      PRE_HANDOFF,
      "[transfer agent]: My name is Cameron with Freedom Debt Relief.",
      "[contact]: Hello.",
      "[transfer agent]: Welcome to your program and your dedicated account.",
      "[transfer agent]: We negotiate with your creditors and you authorize settlements.",
      "[transfer agent]: I will transfer you to customer service for an account update.",
      "[contact]: Okay.",
      "[transfer agent]: Thank you for calling Freedom Debt Relief customer service. Press 1 for account help.",
      "[transfer agent]: My name is Devon with Freedom Debt Relief. How can I help?",
    ].join("\n")

    const segment = segmentWelcomeCall(transcript)
    expect(segment.segment_found).toBe(true)
    expect(segment.segment).not.toContain("Press 1 for account help")

    const result = analyzeTransferExperience(segment)
    expect(result.poor_transfer).toBe(false)
    expect(result.ivr_reentry_lines).toEqual([])
  })
})
