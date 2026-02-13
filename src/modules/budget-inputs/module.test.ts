import { describe, it, expect } from "vitest"
import { budgetInputsModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import passFixture from "../../../test/fixtures/responses/budget-inputs-pass.json"
import violationFixture from "../../../test/fixtures/responses/budget-inputs-violation.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("budgetInputsModule", () => {
  it("has correct module name", () => {
    expect(budgetInputsModule.name).toBe(MODULE_NAMES.BUDGET_INPUTS)
  })

  describe("evaluate()", () => {
    it("returns module_name budget_inputs", async () => {
      const llm = createMockLLM(passFixture)
      const request = createEvaluateRequest()
      const result = await budgetInputsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.BUDGET_INPUTS)
    })

    it("sets has_violation false when no compliance violation", async () => {
      const llm = createMockLLM(passFixture)
      const request = createEvaluateRequest()
      const result = await budgetInputsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when budget compliance violation", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await budgetInputsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.BUDGET_COMPLIANCE)
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(passFixture)
      const request = createEvaluateRequest()
      await budgetInputsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("budget_inputs_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(passFixture)
      const request = createEvaluateRequest()
      await budgetInputsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, userPrompt] = llm.getStructuredResponse.mock.calls[0]
      expect(userPrompt).toContain(request.transcript.transcript)
    })

    it("propagates LLM errors", async () => {
      const llm = createFailingLLM()
      const request = createEvaluateRequest()
      await expect(
        budgetInputsModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("LLM failed")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(passFixture)
      const request = createEvaluateRequest()
      const result = await budgetInputsModule.evaluate(
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
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        result: passFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 50,
      }
      expect(budgetInputsModule.extractAlerts(result, "call-1", "agent-1")).toEqual([])
    })

    it("returns alert with budget_compliance violation type", () => {
      const result = {
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
        processing_time_ms: 50,
      }
      const alerts = budgetInputsModule.extractAlerts(result, "call-2", "agent-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.BUDGET_COMPLIANCE)
      expect(alerts[0].call_id).toBe("call-2")
      expect(alerts[0].agent_id).toBe("agent-2")
    })

    it("includes Regal context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
        processing_time_ms: 50,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-2",
      })
      const alerts = budgetInputsModule.extractAlerts(result, "call-2", "agent-2", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-2")
      expect(alerts[0].sfdc_lead_id).toBe("00Q1234567890AB")
    })
  })
})
