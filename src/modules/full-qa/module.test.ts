import { describe, it, expect, vi } from "vitest"
import { fullQAModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import excellentFixture from "../../../test/fixtures/responses/full-qa-excellent.json"
import violationFixture from "../../../test/fixtures/responses/full-qa-violation.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("fullQAModule", () => {
  it("has correct module name", () => {
    expect(fullQAModule.name).toBe(MODULE_NAMES.FULL_QA)
  })

  describe("evaluate()", () => {
    it("returns module_name full_qa", async () => {
      const llm = createMockLLM(excellentFixture)
      const request = createEvaluateRequest()
      const result = await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.FULL_QA)
    })

    it("sets has_violation false when manager_review_required is false", async () => {
      const llm = createMockLLM(excellentFixture)
      const request = createEvaluateRequest()
      const result = await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when manager_review_required is true", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.MANAGER_ESCALATION)
    })

    it("passes correct arguments to LLM", async () => {
      const llm = createMockLLM(excellentFixture)
      const request = createEvaluateRequest()
      await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(llm.getStructuredResponse).toHaveBeenCalledTimes(1)
      const [systemPrompt, userPrompt, schema, schemaName] =
        llm.getStructuredResponse.mock.calls[0]
      expect(typeof systemPrompt).toBe("string")
      expect(userPrompt).toContain(request.transcript.transcript)
      expect(schemaName).toBe("full_qa_evaluation")
    })

    it("includes processing_time_ms", async () => {
      const llm = createMockLLM(excellentFixture)
      const request = createEvaluateRequest()
      const result = await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0)
    })

    it("stores raw LLM result", async () => {
      const llm = createMockLLM(excellentFixture)
      const request = createEvaluateRequest()
      const result = await fullQAModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.result).toEqual(excellentFixture)
    })

    it("propagates LLM errors", async () => {
      const llm = createFailingLLM(new Error("LLM timeout"))
      const request = createEvaluateRequest()
      await expect(
        fullQAModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("LLM timeout")
    })
  })

  describe("extractAlerts()", () => {
    it("returns empty array when no violation", () => {
      const result = {
        module_name: MODULE_NAMES.FULL_QA,
        result: excellentFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 100,
      }
      expect(fullQAModule.extractAlerts(result, "call-123", "agent-1")).toEqual([])
    })

    it("returns alert with correct fields when violation", () => {
      const result = {
        module_name: MODULE_NAMES.FULL_QA,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
        processing_time_ms: 100,
      }
      const alerts = fullQAModule.extractAlerts(result, "call-456", "agent-789")
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({
        module_name: MODULE_NAMES.FULL_QA,
        violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
        call_id: "call-456",
        agent_id: "agent-789",
        result: violationFixture,
      })
    })

    it("includes Regal context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.FULL_QA,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
        processing_time_ms: 100,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-456",
      })
      const alerts = fullQAModule.extractAlerts(result, "call-456", "agent-789", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-456")
      expect(alerts[0].sfdc_lead_id).toBe("00Q1234567890AB")
    })
  })
})
