import { describe, it, expect } from "vitest"
import {
  finalizeGotaCheck,
  resolveGotaTypeFromLeadContext,
  findHandlingAgentEvidence,
  REQUIRED_DISCLOSURE_LABELS,
  GOTA_BEAT_LABELS,
} from "./logic"
import { GOTA_SCRIPT_VERSION, REQUIRED_DISCLOSURE_KEYS } from "../../schemas/gota-check"
import type { GotaCheckModelResponse } from "../../schemas/gota-check"
import conductedFixture from "../../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../../test/fixtures/responses/gota-check-violation.json"
import partialBeatsFixture from "../../../test/fixtures/responses/gota-check-partial-beats.json"

const model = (overrides: Partial<GotaCheckModelResponse> = {}): GotaCheckModelResponse =>
  ({ ...(conductedFixture as GotaCheckModelResponse), ...overrides })

/** Build a transcript where every non-empty evidence quote is spoken by [handling agent], in disclosure order. */
function handlingAgentTranscript(m: GotaCheckModelResponse): string {
  const quotes = [
    ...REQUIRED_DISCLOSURE_KEYS.map((k) => m.required_disclosures[k].evidence_quote),
    m.enrollment_evidence_quote,
    m.gota_evidence_quote,
    m.fee_structure_evidence,
    m.cancellation_rights_evidence,
    m.do_not_sign_page_evidence,
    m.creditor_list_evidence,
    m.dedicated_account_evidence,
    m.banking_readback_evidence,
    m.ssn_verification_evidence,
    m.california_followup_evidence,
    m.wc_transfer_brief_evidence,
    m.wc_transfer_evidence_quote,
    m.key_evidence_quote,
  ].filter((q) => q.length > 0)
  return quotes.map((q) => `[handling agent]: ${q}`).join("\n")
}

describe("resolveGotaTypeFromLeadContext", () => {
  it("California client state wins over the legal-state red/green flag", () => {
    expect(resolveGotaTypeFromLeadContext({ client_state: " ca ", legal_state: "Yes" })).toBe("fdr_california")
    expect(resolveGotaTypeFromLeadContext({ client_state: "Ca" })).toBe("fdr_california")
    expect(resolveGotaTypeFromLeadContext({ client_state: "CALIFORNIA" })).toBeUndefined()
  })

  it("maps non-California legal-state values to red or green", () => {
    expect(resolveGotaTypeFromLeadContext({ client_state: "NY", legal_state: " yes " })).toBe("turnbull_red")
    expect(resolveGotaTypeFromLeadContext({ client_state: "NJ", legal_state: "NO" })).toBe("fdr_green")
  })

  it("returns undefined for missing/unknown lead metadata", () => {
    expect(resolveGotaTypeFromLeadContext(undefined)).toBeUndefined()
    expect(resolveGotaTypeFromLeadContext({})).toBeUndefined()
    expect(resolveGotaTypeFromLeadContext({ client_state: "NY" })).toBeUndefined()
    expect(resolveGotaTypeFromLeadContext({ legal_state: "maybe" })).toBeUndefined()
  })
})

describe("finalizeGotaCheck — green/red happy path", () => {
  it("no violation and script version stamped on a fully-compliant standard signing", () => {
    const m = model()
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(false)
    expect(result.script_version).toBe(GOTA_SCRIPT_VERSION)
    expect(result.required_disclosures_compliant).toBe(true)
    expect(result.required_disclosures_in_order).toBe(true)
    expect(result.gota_conducted).toBe(true)
    expect(result.missing_required_disclosures).toEqual([])
  })
})

describe("finalizeGotaCheck — violations", () => {
  it("flags a completed standard signing with no disclosures and no walkthrough", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse), violation: false })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(true)
    expect(result.required_disclosures_compliant).toBe(false)
  })

  it("flags a missing required disclosure even when the model marked it compliant", () => {
    const m = model({
      required_disclosures: {
        ...conductedFixture.required_disclosures,
        tax_consequences: { compliant: false, evidence_quote: "" },
      } as GotaCheckModelResponse["required_disclosures"],
      required_disclosures_compliant: true,
    })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(true)
    expect(result.required_disclosures_compliant).toBe(false)
    expect(result.missing_required_disclosures).toContain(REQUIRED_DISCLOSURE_LABELS.tax_consequences)
  })

  it("flags out-of-order disclosures computed from handling-agent positions", () => {
    const m = model()
    // Reverse the disclosure order in the transcript.
    const reversed = [...REQUIRED_DISCLOSURE_KEYS]
      .reverse()
      .map((k) => `[handling agent]: ${m.required_disclosures[k].evidence_quote}`)
      .join("\n")
    const result = finalizeGotaCheck(m, reversed)
    expect(result.required_disclosures_in_order).toBe(false)
    expect(result.required_disclosures_compliant).toBe(false)
    expect(result.violation).toBe(true)
    expect(result.missing_required_disclosures).toEqual([])
  })

  it("flags a signed call whose only walkthrough evidence is under [transfer agent]", () => {
    const m = model()
    const t = handlingAgentTranscript(m).replace(
      `[handling agent]: ${m.gota_evidence_quote}`,
      `[transfer agent]: ${m.gota_evidence_quote}`,
    )
    const result = finalizeGotaCheck(m, t)
    expect(result.gota_conducted).toBe(false)
    expect(result.gota_evidence_quote).toBe("")
    expect(result.violation).toBe(true)
  })
})

describe("finalizeGotaCheck — speaker enforcement", () => {
  it("rejects a fabricated quote that is nowhere in the transcript", () => {
    const m = model()
    const result = finalizeGotaCheck(m, "[handling agent]: totally unrelated small talk")
    expect(result.gota_evidence_quote).toBe("")
    expect(result.required_disclosures.tax_consequences.compliant).toBe(false)
  })

  it("selects the handling-agent occurrence when identical text appears first under transfer agent", () => {
    const m = model({
      gota_conducted: true,
      gota_evidence_quote: "I'll guide you page by page",
    })
    const transcript = [
      "[transfer agent]: I'll guide you page by page",
      "[contact]: okay",
      "[handling agent]: I'll guide you page by page",
    ].join("\n")
    const result = finalizeGotaCheck(m, transcript)
    expect(result.gota_evidence_quote).toBe("I'll guide you page by page")
    expect(result.gota_conducted).toBe(true)
  })

  it("does not throw and produces no violation on an empty transcript", () => {
    const m = model()
    const result = finalizeGotaCheck(m, "")
    expect(result.required_disclosures_in_order).toBe(false)
    expect(result.gota_evidence_quote).toBe("")
    // enrollment_completed stays true but no walkthrough evidence -> violation for a standard signing
    expect(result.violation).toBe(true)
  })
})

describe("finalizeGotaCheck — non-signing stages", () => {
  it("no violation for a not_applicable stage", () => {
    const m = model({ call_stage: "not_applicable", enrollment_completed: false })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(false)
    expect(result.missing_beats).toEqual([])
    expect(result.missing_required_disclosures).toEqual([])
  })

  it("no violation for an abandoned standard signing (enrollment_completed=false)", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse), enrollment_completed: false })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(false)
  })

  it("no violation for an unknown stage", () => {
    const m = model({ call_stage: "unknown" })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(false)
  })

  it("missing coaching beats never create a violation", () => {
    const m = model({
      banking_readback_beat_covered: false,
      banking_readback_evidence: "",
      ssn_verification_beat_covered: false,
      ssn_verification_evidence: "",
    })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.violation).toBe(false)
    expect(result.missing_beats).toContain(GOTA_BEAT_LABELS.banking_confirmation)
    expect(result.missing_beats).toContain(GOTA_BEAT_LABELS.ssn_verification)
  })

  it("applies the Turnbull cancellation-page beat only to red", () => {
    const green = finalizeGotaCheck(model({ gota_type: "fdr_green" }), handlingAgentTranscript(model()))
    expect(green.missing_beats).not.toContain(GOTA_BEAT_LABELS.do_not_sign_page)
    const redModel = model({ gota_type: "turnbull_red", do_not_sign_page_beat_covered: false })
    const red = finalizeGotaCheck(redModel, handlingAgentTranscript(redModel))
    expect(red.missing_beats).toContain(GOTA_BEAT_LABELS.do_not_sign_page)
  })
})

describe("findHandlingAgentEvidence — cross-speaker guard", () => {
  it("accepts single-line handling-agent evidence", () => {
    const t = "[handling agent]: I'll guide you page by page"
    expect(findHandlingAgentEvidence("I'll guide you page by page", t).evidence).toBe(
      "I'll guide you page by page",
    )
  })

  it("accepts evidence spanning consecutive handling-agent turns", () => {
    const t = "[handling agent]: part one of the disclosure\n[handling agent]: part two of the disclosure"
    const span = "part one of the disclosure\n[handling agent]: part two of the disclosure"
    const found = findHandlingAgentEvidence(span, t)
    expect(found.evidence).toBe(span)
    expect(found.position).toBeGreaterThanOrEqual(0)
  })

  it("rejects multiline evidence that would span into a transfer-agent turn", () => {
    const t = "[handling agent]: sign here\n[transfer agent]: welcome aboard"
    expect(findHandlingAgentEvidence("sign here\n[transfer agent]: welcome aboard", t).evidence).toBe("")
  })

  it("rejects a span that crosses into a [contact] turn", () => {
    const t = "[handling agent]: are you ready\n[contact]: yes I am\n[handling agent]: great"
    expect(findHandlingAgentEvidence("are you ready\n[contact]: yes I am\n[handling agent]: great", t).evidence).toBe("")
  })

  it("rejects evidence containing an embedded non-handling speaker label", () => {
    const t = "[handling agent]: sign here [transfer agent]: welcome aboard"
    expect(findHandlingAgentEvidence("sign here [transfer agent]: welcome aboard", t).evidence).toBe("")
  })
})

describe("finalizeGotaCheck — disclosure completeness anchors", () => {
  it("accepts the full FDR (green) disclosures from the conducted fixture", () => {
    const m = model()
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.required_disclosures_compliant).toBe(true)
    for (const key of REQUIRED_DISCLOSURE_KEYS) {
      expect(result.required_disclosures[key].compliant).toBe(true)
    }
  })

  it("accepts the full Turnbull (red) disclosures from the partial-beats fixture", () => {
    const m = model(partialBeatsFixture as GotaCheckModelResponse)
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    for (const key of REQUIRED_DISCLOSURE_KEYS) {
      expect(result.required_disclosures[key].compliant).toBe(true)
    }
  })

  it("accepts a disclosure spanning two consecutive handling-agent turns", () => {
    const m = model()
    const fullDisclosure1 = conductedFixture.required_disclosures.program_and_guarantee_limits.evidence_quote
    const [firstSentence, secondSentence] = fullDisclosure1.split(". FDR")
    // Split disclosure 1 across two consecutive [handling agent] turns.
    const splitLines = `[handling agent]: ${firstSentence}.\n[handling agent]: FDR${secondSentence}`
    const spanQuote = `${firstSentence}.\n[handling agent]: FDR${secondSentence}`
    const otherLines = REQUIRED_DISCLOSURE_KEYS.filter((k) => k !== "program_and_guarantee_limits").map(
      (k) => `[handling agent]: ${conductedFixture.required_disclosures[k].evidence_quote}`,
    )
    const transcript = [splitLines, ...otherLines].join("\n")
    const spanned = model({
      required_disclosures: {
        ...conductedFixture.required_disclosures,
        program_and_guarantee_limits: { compliant: true, evidence_quote: spanQuote },
      } as GotaCheckModelResponse["required_disclosures"],
    })
    const result = finalizeGotaCheck(spanned, transcript)
    expect(result.required_disclosures.program_and_guarantee_limits.compliant).toBe(true)
  })

  it("accepts an ASR rendering of the tax disclosure (numeral spelled out)", () => {
    const asrTax =
      "Your creditors may report settlement savings of six hundred dollars or more to the IRS. FDR does not provide tax advice. You should consult a tax advisor to determine whether to report these savings as taxable income."
    const transcript = REQUIRED_DISCLOSURE_KEYS.map((k) =>
      k === "tax_consequences"
        ? `[handling agent]: ${asrTax}`
        : `[handling agent]: ${conductedFixture.required_disclosures[k].evidence_quote}`,
    ).join("\n")
    const m = model({
      required_disclosures: {
        ...conductedFixture.required_disclosures,
        tax_consequences: { compliant: true, evidence_quote: asrTax },
      } as GotaCheckModelResponse["required_disclosures"],
    })
    const result = finalizeGotaCheck(m, transcript)
    expect(result.required_disclosures.tax_consequences.compliant).toBe(true)
    expect(result.required_disclosures_compliant).toBe(true)
  })

  it("rejects a partial disclosure quote missing the ending concept even if the model says compliant", () => {
    // Only the opening sentence of disclosure 1 — the required ending concept
    // ("within a certain time") is absent.
    const partialQuote = "Debt resolution is not a loan, is not credit counseling, and is not a credit repair program."
    const m = model({
      required_disclosures: {
        ...conductedFixture.required_disclosures,
        program_and_guarantee_limits: { compliant: true, evidence_quote: partialQuote },
      } as GotaCheckModelResponse["required_disclosures"],
    })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expect(result.required_disclosures.program_and_guarantee_limits.compliant).toBe(false)
    expect(result.required_disclosures_compliant).toBe(false)
    expect(result.violation).toBe(true)
    expect(result.missing_required_disclosures).toContain(
      REQUIRED_DISCLOSURE_LABELS.program_and_guarantee_limits,
    )
  })

  it("rejects a disclosure whose evidence crosses into the transfer agent's turn", () => {
    const m = model()
    // Replace disclosure 9's clean handling-agent line with one whose evidence
    // would need to absorb a following [transfer agent] turn to be complete.
    const full = conductedFixture.required_disclosures.tax_consequences.evidence_quote
    const firstSentence = "Your creditors may report settlement savings of $600 or more to the IRS."
    const rest = full.slice(firstSentence.length).trim()
    const transcript = [
      ...REQUIRED_DISCLOSURE_KEYS.filter((k) => k !== "tax_consequences").map(
        (k) => `[handling agent]: ${conductedFixture.required_disclosures[k].evidence_quote}`,
      ),
      `[handling agent]: ${firstSentence}`,
      `[transfer agent]: ${rest}`,
    ].join("\n")
    const result = finalizeGotaCheck(m, transcript)
    // The complete disclosure text is not present in a single handling-agent turn.
    expect(result.required_disclosures.tax_consequences.compliant).toBe(false)
    expect(result.violation).toBe(true)
  })
})

describe("finalizeGotaCheck — California suppression (fail-closed)", () => {
  const expectSuppressed = (result: ReturnType<typeof finalizeGotaCheck>) => {
    expect(result.violation).toBe(false)
    expect(result.violation_reason.toLowerCase()).toContain("california")
  }

  it("suppresses when resolved lead state is California, even with noncompliant inputs", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse) })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m), "fdr_california")
    expectSuppressed(result)
    expect(result.gota_type).toBe("fdr_california")
  })

  it("suppresses when the model gota_type is fdr_california", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse), gota_type: "fdr_california" })
    expectSuppressed(finalizeGotaCheck(m, handlingAgentTranscript(m)))
  })

  it("suppresses a California initial-signing stage with missing disclosures", () => {
    const m = model({
      call_stage: "california_initial_signing",
      gota_type: "fdr_california",
      required_disclosures: {
        ...conductedFixture.required_disclosures,
        withdrawal_rights: { compliant: false, evidence_quote: "" },
      } as GotaCheckModelResponse["required_disclosures"],
    })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expectSuppressed(result)
    // fields still computed for review
    expect(result.missing_required_disclosures).toContain(REQUIRED_DISCLOSURE_LABELS.withdrawal_rights)
  })

  it("suppresses a California Day-4 execution stage", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse), call_stage: "california_day4_execution", gota_type: "fdr_california" })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m))
    expectSuppressed(result)
    expect(result.missing_beats).toEqual([])
    expect(result.missing_required_disclosures).toEqual([])
  })

  it("suppresses when lead context resolves California but the model claims a completed standard signing", () => {
    const m = model({ ...(violationFixture as GotaCheckModelResponse), call_stage: "standard_signing", enrollment_completed: true })
    const result = finalizeGotaCheck(m, handlingAgentTranscript(m), "fdr_california")
    expectSuppressed(result)
  })
})
