import { describe, it, expect } from "vitest"
import { warmTransferModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import noViolationFixture from "../../../test/fixtures/responses/warm-transfer-no-violation.json"
import violationFixture from "../../../test/fixtures/responses/warm-transfer-violation.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("warmTransferModule", () => {
  it("has correct module name", () => {
    expect(warmTransferModule.name).toBe(MODULE_NAMES.WARM_TRANSFER)
  })

  describe("evaluate()", () => {
    it("returns module_name warm_transfer", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.WARM_TRANSFER)
    })

    it("sets has_violation false when no warm transfer violation", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when warm transfer violation", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.WARM_TRANSFER)
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("warm_transfer_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await warmTransferModule.evaluate(
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
        warmTransferModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("timeout")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0)
    })

    it("stores raw LLM result", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await warmTransferModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.result).toEqual(noViolationFixture)
    })
  })

  describe("extractAlerts()", () => {
    it("returns empty array when no violation", () => {
      const result = {
        module_name: MODULE_NAMES.WARM_TRANSFER,
        result: noViolationFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 75,
      }
      expect(warmTransferModule.extractAlerts(result, "call-1")).toEqual([])
    })

    it("returns alert with warm_transfer violation type", () => {
      const result = {
        module_name: MODULE_NAMES.WARM_TRANSFER,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.WARM_TRANSFER,
        processing_time_ms: 75,
      }
      const alerts = warmTransferModule.extractAlerts(result, "call-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.WARM_TRANSFER)
      expect(alerts[0].call_id).toBe("call-2")
      expect(alerts[0].module_name).toBe(MODULE_NAMES.WARM_TRANSFER)
    })
  })
})
