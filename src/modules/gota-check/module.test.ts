import { describe, it, expect } from "vitest"
import { gotaCheckModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest as createBaseEvaluateRequest } from "../../../test/helpers/create-request"
import conductedFixture from "../../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../../test/fixtures/responses/gota-check-partial-beats.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { resolveGotaTypeFromLeadContext } from "./logic"

type GotaFixture = typeof conductedFixture

function fixtureEvidence(fixture: GotaFixture): string[] {
  return [
    ...Object.values(fixture.required_disclosures).map((assessment) => assessment.evidence_quote),
    fixture.enrollment_evidence_quote,
    fixture.gota_evidence_quote,
    fixture.fee_structure_evidence,
    fixture.cancellation_rights_evidence,
    fixture.do_not_sign_page_evidence,
    fixture.creditor_list_evidence,
    fixture.dedicated_account_evidence,
    fixture.banking_readback_evidence,
    fixture.ssn_verification_evidence,
    fixture.california_followup_evidence,
    fixture.wc_transfer_brief_evidence,
    fixture.wc_transfer_evidence_quote,
    fixture.key_evidence_quote,
  ].filter((quote) => quote.length > 0)
}

function createRequestFromFixture(
  fixture: GotaFixture,
  overrides: Parameters<typeof createBaseEvaluateRequest>[0] = {},
) {
  const base = createBaseEvaluateRequest()
  const evidenceTranscript = fixtureEvidence(fixture)
    .map((quote) => `[handling agent]: ${quote}`)
    .join("\n")

  return createBaseEvaluateRequest({
    ...overrides,
    transcript: overrides.transcript ?? {
      ...base.transcript,
      transcript: evidenceTranscript,
    },
  })
}

function createEvaluateRequest(
  overrides: Parameters<typeof createBaseEvaluateRequest>[0] = {},
) {
  return createRequestFromFixture(conductedFixture, overrides)
}

describe("resolveGotaTypeFromLeadContext", () => {
  it("uses California state before the legal-state red/green flag", () => {
    expect(
      resolveGotaTypeFromLeadContext({
        client_state: " ca ",
        legal_state: "Yes",
      }),
    ).toBe("fdr_california")
  })

  it("maps non-California legal-state values to the red or green guide", () => {
    expect(resolveGotaTypeFromLeadContext({ client_state: "NY", legal_state: " yes " })).toBe(
      "turnbull_red",
    )
    expect(resolveGotaTypeFromLeadContext({ client_state: "NJ", legal_state: "NO" })).toBe(
      "fdr_green",
    )
  })

  it("leaves guide selection unresolved when lead metadata is unavailable", () => {
    expect(resolveGotaTypeFromLeadContext(undefined)).toBeUndefined()
    expect(resolveGotaTypeFromLeadContext({ client_state: "NY" })).toBeUndefined()
  })
})

describe("gotaCheckModule", () => {
  it("has correct module name", () => {
    expect(gotaCheckModule.name).toBe(MODULE_NAMES.GOTA_CHECK)
  })

  describe("evaluate()", () => {
    it("returns module_name gota_check", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.module_name).toBe(MODULE_NAMES.GOTA_CHECK)
    })

    it("no violation when the GOTA walkthrough was conducted", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("downgrades a disclosure when its evidence is not literal transcript text", async () => {
      const transcript = "[handling agent]: I will guide you through the agreement now."
      const llm = createMockLLM({
        ...conductedFixture,
        required_disclosures: {
          ...conductedFixture.required_disclosures,
          tax_consequences: {
            compliant: true,
            evidence_quote: "Your creditors may report settlement savings to the IRS.",
          },
        },
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(transcript, request, llm as any)

      expect((result.result as any).required_disclosures.tax_consequences).toEqual({
        compliant: false,
        evidence_quote: "",
      })
      expect(result.has_violation).toBe(true)
    })

    it("violation when literal disclosure evidence appears out of order", async () => {
      const disclosureEvidence = Object.values(conductedFixture.required_disclosures)
        .map((assessment) => assessment.evidence_quote)
        .reverse()
        .map((quote) => `[handling agent]: ${quote}`)
        .join("\n")
      const llm = createMockLLM({
        ...conductedFixture,
        required_disclosures_in_order: true,
        required_disclosures_compliant: true,
        violation: false,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(disclosureEvidence, request, llm as any)

      expect(result.has_violation).toBe(true)
      expect((result.result as any).required_disclosures_in_order).toBe(false)
      expect((result.result as any).required_disclosures_compliant).toBe(false)
      expect((result.result as any).missing_required_disclosures).toEqual([])
    })

    it("violation when signing completed with GOTA but a required disclosure was noncompliant", async () => {
      const llm = createMockLLM({
        ...conductedFixture,
        required_disclosures: {
          ...conductedFixture.required_disclosures,
          tax_consequences: { compliant: false, evidence_quote: "" },
        },
        required_disclosures_compliant: true,
        missing_required_disclosures: [],
        violation: false,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)

      expect(result.has_violation).toBe(true)
      expect((result.result as any).required_disclosures_compliant).toBe(false)
      expect((result.result as any).missing_required_disclosures).toContain("Tax consequences / IRS reporting")
    })

    it("violation when the client signed without a GOTA walkthrough", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
    })

    it("does not flag an abandoned standard signing session", async () => {
      const llm = createMockLLM({
        ...violationFixture,
        call_stage: "standard_signing",
        enrollment_completed: false,
        violation: true,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)

      expect(result.has_violation).toBe(false)
      expect((result.result as any).missing_required_disclosures).toEqual([])
    })

    it("enforces disclosures on California initial signing before final execution", async () => {
      const llm = createMockLLM({
        ...conductedFixture,
        call_stage: "california_initial_signing",
        enrollment_completed: false,
        gota_type: "fdr_california",
        required_disclosures: {
          ...conductedFixture.required_disclosures,
          withdrawal_rights: { compliant: false, evidence_quote: "" },
        },
        wc_transfer_occurred: false,
        wc_transfer_brief_beat_covered: false,
        california_followup_beat_covered: true,
        violation: false,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)

      expect(result.has_violation).toBe(true)
      expect((result.result as any).missing_required_disclosures).toContain(
        "Withdrawal rights and return of funds",
      )
      expect((result.result as any).missing_beats).not.toContain("Warm-transfer brief to welcome team")
    })

    it("does not grade the full combined process on a California Day-4 execution call", async () => {
      const llm = createMockLLM({
        ...violationFixture,
        call_stage: "california_day4_execution",
        gota_type: "fdr_california",
        violation: true,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)

      expect(result.has_violation).toBe(false)
      expect((result.result as any).missing_required_disclosures).toEqual([])
      expect((result.result as any).missing_beats).toEqual([])
    })

    it("does not override an explicit non-applicable stage from enrollment metadata alone", async () => {
      const llm = createMockLLM({
        ...violationFixture,
        call_stage: "not_applicable",
        enrollment_completed: true,
        violation: true,
      })
      const request = createEvaluateRequest()

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)

      expect(result.has_violation).toBe(false)
      expect((result.result as any).missing_required_disclosures).toEqual([])
    })

    it("no violation when no enrollment was signed on the call", async () => {
      const llm = createMockLLM(notEnrolledFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("server-side recount overrides LLM violation=true when GOTA was conducted with missed beats", async () => {
      // partialBeatsFixture: gota_conducted=true, two beats missed, and the LLM
      // incorrectly set violation=true. Missing beats never fire the alert.
      const llm = createMockLLM(partialBeatsFixture)
      const request = createRequestFromFixture(partialBeatsFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
      expect((result.result as any).violation).toBe(false)
    })

    it("server-side recount rebuilds missing_beats from per-beat flags", async () => {
      const llm = createMockLLM(partialBeatsFixture)
      const request = createRequestFromFixture(partialBeatsFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toEqual([
        "Banking details and draft-date confirmation",
        "Turnbull cancellation notice (footer only; cancellation line blank)",
      ])
    })

    it("server-side recount lists every applicable standard-signing beat when no walkthrough occurred", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toEqual([
        "Fee structure (performance-based fees)",
        "Cancellation rights (cancel anytime + applicable state terms)",
        "Creditor list verification",
        "Dedicated account ownership, independence, and fees",
        "Banking details and draft-date confirmation",
        "SSN and date-of-birth verification",
        "Warm-transfer brief to welcome team",
      ])
    })

    it("server-side recount flips LLM violation=false to true when signed without GOTA", async () => {
      const llm = createMockLLM({ ...violationFixture, violation: false })
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("gota_check_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
      expect(userPrompt).toContain(request.transcript.transcript)
    })

    it("uses Regal lead context as the authoritative guide variant", async () => {
      const llm = createMockLLM({ ...conductedFixture, gota_type: "turnbull_red" })
      const request = createEvaluateRequest({
        lead_context: {
          client_state: "CA",
          legal_state: "Yes",
        },
      })

      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]

      expect(userPrompt).toContain("fdr_california")
      expect(userPrompt).toContain("does not identify whether this is the initial or Day-4 call")
      expect((result.result as any).gota_type).toBe("fdr_california")
    })

    it("propagates LLM errors", async () => {
      const llm = createFailingLLM(new Error("timeout"))
      const request = createEvaluateRequest()
      await expect(
        gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("timeout")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0)
    })
  })

  describe("extractAlerts()", () => {
    it("returns empty array when no violation", () => {
      const result = {
        module_name: MODULE_NAMES.GOTA_CHECK,
        result: conductedFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }
      expect(gotaCheckModule.extractAlerts(result, "call-1", "agent-1")).toEqual([])
    })

    it("returns alert with gota_check violation type", () => {
      const result = {
        module_name: MODULE_NAMES.GOTA_CHECK,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.GOTA_CHECK,
        processing_time_ms: 50,
      }
      const alerts = gotaCheckModule.extractAlerts(result, "call-2", "agent-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
      expect(alerts[0].module_name).toBe(MODULE_NAMES.GOTA_CHECK)
      expect(alerts[0].call_id).toBe("call-2")
    })

    it("includes Regal context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.GOTA_CHECK,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.GOTA_CHECK,
        processing_time_ms: 50,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-2",
      })
      const alerts = gotaCheckModule.extractAlerts(result, "call-2", "agent-2", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-2")
    })
  })
})
