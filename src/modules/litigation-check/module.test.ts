import { describe, it, expect } from "vitest"
import { litigationCheckModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import noViolationFixture from "../../../test/fixtures/responses/litigation-check-no-violation.json"
import violationFixture from "../../../test/fixtures/responses/litigation-check-violation.json"
import notApplicableFixture from "../../../test/fixtures/responses/litigation-check-not-applicable.json"
import screeningNegativeFixture from "../../../test/fixtures/responses/litigation-check-screening-negative.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("litigationCheckModule", () => {
  it("has correct module name", () => {
    expect(litigationCheckModule.name).toBe(MODULE_NAMES.LITIGATION_CHECK)
  })

  describe("evaluate()", () => {
    it("returns module_name litigation_check", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.LITIGATION_CHECK)
    })

    it("sets has_violation false when litigation not discussed", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation false when discussed and agent communicated restriction", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when discussed and agent did NOT communicate restriction", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.LITIGATION_CHECK)
    })

    it("sets has_violation false for screening question with negative response", async () => {
      const llm = createMockLLM(screeningNegativeFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("server-side recount overrides LLM if it miscounts — forces violation when discussed but not communicated", async () => {
      // LLM says violation=false, but litigation_discussed=true and agent_communicated_restriction=false
      const badLLMResponse = {
        ...violationFixture,
        violation: false, // LLM got this wrong
      }
      const llm = createMockLLM(badLLMResponse)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.LITIGATION_CHECK)
    })

    it("server-side recount overrides LLM if it miscounts — clears violation when agent communicated", async () => {
      // LLM says violation=true, but agent_communicated_restriction=true
      const badLLMResponse = {
        ...noViolationFixture,
        violation: true, // LLM got this wrong
      }
      const llm = createMockLLM(badLLMResponse)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("litigation_check_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await litigationCheckModule.evaluate(
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
        litigationCheckModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("timeout")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0)
    })

    it("stores raw LLM result", async () => {
      const llm = createMockLLM(notApplicableFixture)
      const request = createEvaluateRequest()
      const result = await litigationCheckModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.result).toMatchObject({
        litigation_discussed: false,
        mentions: [],
      })
    })
  })

  describe("extractAlerts()", () => {
    it("returns empty array when no violation", () => {
      const result = {
        module_name: MODULE_NAMES.LITIGATION_CHECK,
        result: noViolationFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 75,
      }
      expect(litigationCheckModule.extractAlerts(result, "call-1", "agent-1")).toEqual([])
    })

    it("returns alert with litigation_check violation type", () => {
      const result = {
        module_name: MODULE_NAMES.LITIGATION_CHECK,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.LITIGATION_CHECK,
        processing_time_ms: 75,
      }
      const alerts = litigationCheckModule.extractAlerts(result, "call-2", "agent-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.LITIGATION_CHECK)
      expect(alerts[0].call_id).toBe("call-2")
      expect(alerts[0].agent_id).toBe("agent-2")
      expect(alerts[0].module_name).toBe(MODULE_NAMES.LITIGATION_CHECK)
    })

    it("includes Regal context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.LITIGATION_CHECK,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.LITIGATION_CHECK,
        processing_time_ms: 75,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-2",
      })
      const alerts = litigationCheckModule.extractAlerts(result, "call-2", "agent-2", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-2")
      expect(alerts[0].sfdc_lead_id).toBe("00Q1234567890AB")
    })
  })
})
