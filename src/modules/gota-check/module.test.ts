import { describe, it, expect } from "vitest"
import { gotaCheckModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import conductedFixture from "../../../test/fixtures/responses/gota-check-conducted.json"
import violationFixture from "../../../test/fixtures/responses/gota-check-violation.json"
import notEnrolledFixture from "../../../test/fixtures/responses/gota-check-not-enrolled.json"
import partialBeatsFixture from "../../../test/fixtures/responses/gota-check-partial-beats.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

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

    it("violation when the client signed without a GOTA walkthrough", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.GOTA_CHECK)
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
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
      expect((result.result as any).violation).toBe(false)
    })

    it("server-side recount rebuilds missing_beats from per-beat flags", async () => {
      const llm = createMockLLM(partialBeatsFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toEqual([
        "Cancellation notice DO-NOT-SIGN page",
        "Banking details read-back",
      ])
    })

    it("stores evidence as a literal transcript substring when the model moves the speaker label onto an excerpt", async () => {
      const transcript = "[handling agent]: On page seven, the fee is performance-based and nothing is earned until settlement."
      const llm = createMockLLM({
        ...conductedFixture,
        fee_structure_evidence: "[handling agent]: the fee is performance-based and nothing is earned until settlement.",
      })
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(transcript, request, llm as any)
      expect((result.result as any).fee_structure_evidence).toBe(
        "the fee is performance-based and nothing is earned until settlement.",
      )
    })

    it("clears evidence that cannot be found literally in the transcript", async () => {
      const transcript = "[handling agent]: Review the agreement with me.\n[contact]: Okay."
      const llm = createMockLLM({
        ...conductedFixture,
        gota_evidence_quote: "[handling agent]: Review the agreement and sign every page with me.",
      })
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(transcript, request, llm as any)
      expect((result.result as any).gota_evidence_quote).toBe("")
    })

    it("server-side recount lists all 6 beats missing when nothing was walked through", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await gotaCheckModule.evaluate(request.transcript.transcript, request, llm as any)
      expect((result.result as any).missing_beats).toHaveLength(6)
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
