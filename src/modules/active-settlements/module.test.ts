import { describe, it, expect } from "vitest"
import { activeSettlementsModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import notApplicableFixture from "../../../test/fixtures/responses/active-settlements-not-applicable.json"
import detectedFixture from "../../../test/fixtures/responses/active-settlements-detected.json"
import withCompetitorFixture from "../../../test/fixtures/responses/active-settlements-with-competitor.json"
import declinedOfferFixture from "../../../test/fixtures/responses/active-settlements-declined-offer.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("activeSettlementsModule", () => {
  it("has correct module name", () => {
    expect(activeSettlementsModule.name).toBe(MODULE_NAMES.ACTIVE_SETTLEMENTS)
  })

  describe("evaluate()", () => {
    it("returns module_name active_settlements", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.ACTIVE_SETTLEMENTS)
    })

    it("sets has_violation false when no settlement language found", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when active settlements detected", async () => {
      const llm = createMockLLM(detectedFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.ACTIVE_SETTLEMENTS)
    })

    it("does not flag declined offers without ongoing engagement", async () => {
      const llm = createMockLLM(declinedOfferFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("server-side recount overrides LLM if it miscounts — forces violation when detected", async () => {
      const badLLMResponse = {
        ...detectedFixture,
        violation: false,
      }
      const llm = createMockLLM(badLLMResponse)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.ACTIVE_SETTLEMENTS)
    })

    it("server-side recount overrides LLM if it miscounts — clears violation when not detected", async () => {
      const badLLMResponse = {
        ...notApplicableFixture,
        violation: true,
      }
      const llm = createMockLLM(badLLMResponse)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("forces cancellation_confirmed to n/a when not enrolled with competitor", async () => {
      const inconsistent = {
        ...detectedFixture,
        enrolled_with_competitor: "no",
        cancellation_confirmed: "yes",
        cancellation_evidence_quote: "this should be cleared",
      }
      const llm = createMockLLM(inconsistent)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const r = result.result as any
      expect(r.cancellation_confirmed).toBe("n/a")
      expect(r.cancellation_evidence_quote).toBe("")
    })

    it("preserves cancellation_confirmed when enrolled with competitor", async () => {
      const llm = createMockLLM(withCompetitorFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const r = result.result as any
      expect(r.enrolled_with_competitor).toBe("yes")
      expect(r.cancellation_confirmed).toBe("yes")
      expect(r.cancellation_evidence_quote).toContain("call Beyond Finance")
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("active_settlements_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
      expect(userPrompt).toContain(request.transcript.transcript)
    })

    it("propagates LLM errors", async () => {
      const llm = createFailingLLM(new Error("timeout"))
      const request = createEvaluateRequest()
      await expect(
        activeSettlementsModule.evaluate(
          request.transcript.transcript,
          request,
          llm as any,
        ),
      ).rejects.toThrow("timeout")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      const result = await activeSettlementsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0)
    })
  })

  describe("extractAlerts()", () => {
    it("returns empty array when no violation", () => {
      const result = {
        module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
        result: notApplicableFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 75,
      }
      expect(activeSettlementsModule.extractAlerts(result, "call-1", "agent-1")).toEqual([])
    })

    it("returns alert with active_settlements violation type", () => {
      const result = {
        module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
        result: detectedFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
        processing_time_ms: 75,
      }
      const alerts = activeSettlementsModule.extractAlerts(result, "call-2", "agent-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.ACTIVE_SETTLEMENTS)
      expect(alerts[0].call_id).toBe("call-2")
      expect(alerts[0].agent_id).toBe("agent-2")
      expect(alerts[0].module_name).toBe(MODULE_NAMES.ACTIVE_SETTLEMENTS)
    })

    it("includes context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
        result: withCompetitorFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
        processing_time_ms: 75,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-2",
      })
      const alerts = activeSettlementsModule.extractAlerts(result, "call-2", "agent-2", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-2")
      expect(alerts[0].sfdc_lead_id).toBe("00Q1234567890AB")
    })
  })
})
