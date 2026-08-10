import { describe, it, expect } from "vitest"
import { gotaCheckModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest as createBaseEvaluateRequest } from "../../../test/helpers/create-request"
import conductedFixture from "../../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../../test/fixtures/responses/gota-check-partial-beats.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { GOTA_BEAT_LABELS } from "./logic"
import { REQUIRED_DISCLOSURE_KEYS } from "../../schemas/gota-check"
import type { EvaluateRequest } from "../../schemas/requests"

type GotaFixture = typeof conductedFixture

/** All non-empty evidence quotes from a fixture, disclosures first (canonical order). */
function fixtureEvidence(fixture: GotaFixture): string[] {
  return [
    ...REQUIRED_DISCLOSURE_KEYS.map((k) => fixture.required_disclosures[k].evidence_quote),
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

/** Build a request whose transcript contains each fixture quote under a [handling agent] line. */
function createRequestFromFixture(
  fixture: GotaFixture,
  overrides: Partial<EvaluateRequest> = {},
): EvaluateRequest {
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

function createEvaluateRequest(overrides: Partial<EvaluateRequest> = {}): EvaluateRequest {
  return createRequestFromFixture(conductedFixture, overrides)
}

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

    it("no violation on a compliant completed standard signing", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
      expect((result.result as any).script_version).toBe("combined_psc_gota_vf_8_6_26")
    })

    it("violation when the client signed without a GOTA walkthrough", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createRequestFromFixture(violationFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
    })

    it("downgrades a disclosure whose evidence is not literal handling-agent text", async () => {
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

    it("rejects a walkthrough quote spoken only by the transfer agent", async () => {
      const request = createEvaluateRequest()
      const transcript = request.transcript.transcript.replace(
        `[handling agent]: ${conductedFixture.gota_evidence_quote}`,
        `[transfer agent]: ${conductedFixture.gota_evidence_quote}`,
      )
      const llm = createMockLLM(conductedFixture)
      const result = await gotaCheckModule.evaluate(transcript, request, llm as any)
      expect((result.result as any).gota_conducted).toBe(false)
      expect(result.has_violation).toBe(true)
    })

    it("no violation when no enrollment was signed on the call", async () => {
      const llm = createMockLLM(notEnrolledFixture)
      const request = createRequestFromFixture(notEnrolledFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("missing coaching beats never fire the alert (partial-beats fixture)", async () => {
      const llm = createMockLLM(partialBeatsFixture)
      const request = createRequestFromFixture(partialBeatsFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
      expect((result.result as any).violation).toBe(false)
    })

    it("server-side recount rebuilds missing_beats from verified per-beat flags", async () => {
      const llm = createMockLLM(partialBeatsFixture)
      const request = createRequestFromFixture(partialBeatsFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toEqual([
        GOTA_BEAT_LABELS.banking_confirmation,
        GOTA_BEAT_LABELS.do_not_sign_page,
      ])
    })

    it("lists every applicable standard-signing beat when no walkthrough occurred", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createRequestFromFixture(violationFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toEqual([
        GOTA_BEAT_LABELS.fee_structure,
        GOTA_BEAT_LABELS.cancellation_rights,
        GOTA_BEAT_LABELS.creditor_list,
        GOTA_BEAT_LABELS.dedicated_account,
        GOTA_BEAT_LABELS.banking_confirmation,
        GOTA_BEAT_LABELS.ssn_verification,
        GOTA_BEAT_LABELS.wc_transfer_brief,
      ])
    })

    it("flips LLM violation=false to true when signed without disclosures or GOTA", async () => {
      const llm = createMockLLM({ ...violationFixture, violation: false })
      const request = createRequestFromFixture(violationFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
    })

    it("uses Regal lead context as the authoritative guide variant and suppresses California", async () => {
      const llm = createMockLLM({ ...conductedFixture, gota_type: "turnbull_red" })
      const request = createEvaluateRequest({ lead_context: { client_state: "CA", legal_state: "Yes" } })
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
      expect(userPrompt).toContain("fdr_california")
      expect((result.result as any).gota_type).toBe("fdr_california")
      expect(result.has_violation).toBe(false)
      expect((result.result as any).violation_reason.toLowerCase()).toContain("california")
    })

    it("suppresses California by model gota_type even without lead context", async () => {
      const llm = createMockLLM({ ...violationFixture, gota_type: "fdr_california" })
      const request = createRequestFromFixture(violationFixture)
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
    })

    it("does not fire on a California initial-signing stage with missing disclosures", async () => {
      const llm = createMockLLM({
        ...conductedFixture,
        call_stage: "california_initial_signing",
        gota_type: "fdr_california",
        enrollment_completed: false,
        required_disclosures: {
          ...conductedFixture.required_disclosures,
          withdrawal_rights: { compliant: false, evidence_quote: "" },
        },
      })
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect((result.result as any).missing_required_disclosures).toContain(
        "Withdrawal rights and return of funds",
      )
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

    it("does not throw on an empty transcript", async () => {
      const llm = createMockLLM(conductedFixture)
      const request = createEvaluateRequest({
        transcript: { transcript: "", metadata: { duration: 300, timestamp: "2025-01-01T00:00:00Z" } },
      })
      const result = await gotaCheckModule.evaluate("", request, llm as any)
      expect(result.module_name).toBe(MODULE_NAMES.GOTA_CHECK)
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
