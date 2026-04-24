import { describe, it, expect } from "vitest"
import { programExpectationsModule } from "./module"
import { createMockLLM, createFailingLLM } from "../../../test/helpers/mock-llm"
import { createEvaluateRequest } from "../../../test/helpers/create-request"
import noViolationFixture from "../../../test/fixtures/responses/program-expectations-no-violation.json"
import violationFixture from "../../../test/fixtures/responses/program-expectations-violation.json"
import noEnrollmentFixture from "../../../test/fixtures/responses/program-expectations-no-enrollment.json"
import partialFixture from "../../../test/fixtures/responses/program-expectations-partial-violation.json"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"

describe("programExpectationsModule", () => {
  it("has correct module name", () => {
    expect(programExpectationsModule.name).toBe(MODULE_NAMES.PROGRAM_EXPECTATIONS)
  })

  describe("evaluate()", () => {
    it("returns module_name program_expectations", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.module_name).toBe(MODULE_NAMES.PROGRAM_EXPECTATIONS)
    })

    it("sets has_violation false when all phases and downsides covered", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("sets has_violation true when enrollment completed and phases/downsides missing", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.PROGRAM_EXPECTATIONS)
    })

    it("sets has_violation false when enrollment did NOT complete, even if nothing was covered", async () => {
      const llm = createMockLLM(noEnrollmentFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(false)
      expect(result.violation_type).toBeNull()
    })

    it("server-side recount flips LLM violation=false to true when any downside was missed", async () => {
      // partialFixture has enrollment_completed=true, all phases covered, two downsides NOT covered,
      // but the LLM response incorrectly set violation=false. The module must override.
      const llm = createMockLLM(partialFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      expect(result.has_violation).toBe(true)
      expect(result.violation_type).toBe(VIOLATION_TYPES.PROGRAM_EXPECTATIONS)
    })

    it("server-side recount rebuilds missing_elements from per-field flags", async () => {
      const llm = createMockLLM(partialFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const r = result.result as any
      expect(r.missing_elements).toEqual([
        "Downside: payments are withheld",
        "Downside: accounts may close",
      ])
    })

    it("server-side recount lists all 8 missing elements when nothing covered", async () => {
      const llm = createMockLLM(violationFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const r = result.result as any
      expect(r.missing_elements).toHaveLength(8)
      expect(r.missing_elements).toContain("Phase 1: Activation (Months 1–3)")
      expect(r.missing_elements).toContain("Downside: credit score may decline")
    })

    it("passes correct schema name to LLM", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await programExpectationsModule.evaluate(
        request.transcript.transcript,
        request,
        llm as any,
      )
      const [, , , schemaName] = llm.getStructuredResponse.mock.calls[0]
      expect(schemaName).toBe("program_expectations_evaluation")
    })

    it("includes transcript in user prompt", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      await programExpectationsModule.evaluate(
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
        programExpectationsModule.evaluate(request.transcript.transcript, request, llm as any),
      ).rejects.toThrow("timeout")
    })

    it("records processing time", async () => {
      const llm = createMockLLM(noViolationFixture)
      const request = createEvaluateRequest()
      const result = await programExpectationsModule.evaluate(
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
        module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
        result: noViolationFixture,
        has_violation: false,
        violation_type: null,
        processing_time_ms: 75,
      }
      expect(programExpectationsModule.extractAlerts(result, "call-1", "agent-1")).toEqual([])
    })

    it("returns alert with program_expectations violation type", () => {
      const result = {
        module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.PROGRAM_EXPECTATIONS,
        processing_time_ms: 75,
      }
      const alerts = programExpectationsModule.extractAlerts(result, "call-2", "agent-2")
      expect(alerts).toHaveLength(1)
      expect(alerts[0].violation_type).toBe(VIOLATION_TYPES.PROGRAM_EXPECTATIONS)
      expect(alerts[0].call_id).toBe("call-2")
      expect(alerts[0].agent_id).toBe("agent-2")
      expect(alerts[0].module_name).toBe(MODULE_NAMES.PROGRAM_EXPECTATIONS)
    })

    it("includes Regal context fields when callData provided", () => {
      const result = {
        module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
        result: violationFixture,
        has_violation: true,
        violation_type: VIOLATION_TYPES.PROGRAM_EXPECTATIONS,
        processing_time_ms: 75,
      }
      const callData = createEvaluateRequest({
        agent_email: "agent@test.com",
        contact_name: "Jane Smith",
        recording_link: "https://recordings.example.com/call-2",
      })
      const alerts = programExpectationsModule.extractAlerts(result, "call-2", "agent-2", callData)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].agent_email).toBe("agent@test.com")
      expect(alerts[0].contact_name).toBe("Jane Smith")
      expect(alerts[0].recording_link).toBe("https://recordings.example.com/call-2")
      expect(alerts[0].sfdc_lead_id).toBe("00Q1234567890AB")
    })
  })
})
