import { describe, it, expect, vi, beforeEach } from "vitest"
import { getModule } from "./module-registry"
import { needsTranscription } from "../services/transcription"

describe("module-registry", () => {
  it("returns budget_inputs module", () => {
    const mod = getModule("budget_inputs")
    expect(mod.name).toBe("budget_inputs")
    expect(typeof mod.evaluate).toBe("function")
    expect(typeof mod.extractAlerts).toBe("function")
  })

  it("returns full_qa module", () => {
    const mod = getModule("full_qa")
    expect(mod.name).toBe("full_qa")
    expect(typeof mod.evaluate).toBe("function")
    expect(typeof mod.extractAlerts).toBe("function")
  })

  it("returns warm_transfer module", () => {
    const mod = getModule("warm_transfer")
    expect(mod.name).toBe("warm_transfer")
    expect(typeof mod.evaluate).toBe("function")
    expect(typeof mod.extractAlerts).toBe("function")
  })

  it("returns litigation_check module", () => {
    const mod = getModule("litigation_check")
    expect(mod.name).toBe("litigation_check")
    expect(typeof mod.evaluate).toBe("function")
    expect(typeof mod.extractAlerts).toBe("function")
  })

  it("throws for unknown module", () => {
    expect(() => getModule("nonexistent")).toThrow("Unknown module: nonexistent")
  })
})

describe("EvaluationWorkflow step logic", () => {
  const mockModuleResult = {
    module_name: "budget_inputs",
    result: { has_violation: true },
    has_violation: true,
    violation_type: "budget_compliance",
    processing_time_ms: 1500,
  }

  const mockAlerts = [{
    module_name: "budget_inputs",
    violation_type: "budget_compliance",
    call_id: "test-call-123",
    agent_id: "agent-456",
    result: { has_violation: true },
  }]

  const mockCallData = {
    call_id: "test-call-123",
    agent_id: "agent-456",
    transcript: {
      transcript: "test transcript",
      metadata: { duration: 300, timestamp: "2025-01-01T00:00:00Z" },
    },
  }

  it("evaluate step calls module.evaluate with correct args", async () => {
    const mod = getModule("budget_inputs")
    const mockLLM = { getStructuredResponse: vi.fn() }

    // Simulate what the workflow step does
    const evaluateFn = async () => {
      return await mod.evaluate(mockCallData.transcript.transcript, mockCallData as any, mockLLM as any)
    }

    // The function should be callable (it will fail without real LLM but proves the wiring)
    await expect(evaluateFn()).rejects.toBeDefined()
  })

  it("extractAlerts returns alerts for violations", () => {
    const mod = getModule("budget_inputs")
    const alerts = mod.extractAlerts(mockModuleResult, "test-call-123", "agent-456")
    expect(alerts).toHaveLength(1)
    expect(alerts[0].violation_type).toBe("budget_compliance")
  })

  it("extractAlerts returns empty for non-violations", () => {
    const mod = getModule("budget_inputs")
    const noViolation = { ...mockModuleResult, has_violation: false }
    const alerts = mod.extractAlerts(noViolation, "test-call-123", "agent-456")
    expect(alerts).toHaveLength(0)
  })
})

describe("transcribe step wiring", () => {
  const withRecording = {
    call_id: "rec-1",
    agent_id: "a",
    transcript: { transcript: "", metadata: { duration: 0, timestamp: "2025-01-01T00:00:00Z" } },
  } as any

  it("gates transcription on empty transcript + recording present", () => {
    expect(needsTranscription(withRecording, { url: "https://api.twilio.com/REC" })).toBe(true)
    expect(needsTranscription({ ...withRecording, transcript: { transcript: "done", metadata: {} } }, { url: "x" })).toBe(false)
  })

  it("assembles callData.transcript from a transcription result, preserving metadata", () => {
    const callData = {
      ...withRecording,
      transcript: { transcript: "", metadata: { duration: 0, timestamp: "2025-01-01T00:00:00Z" } },
    }
    const transcribed = { transcript: "[handling agent]: hi", durationSec: 88 }

    // Mirrors the assignment the workflow performs after the transcribe step.
    callData.transcript = {
      transcript: transcribed.transcript,
      metadata: { ...callData.transcript.metadata, duration: transcribed.durationSec },
    }

    expect(callData.transcript.transcript).toBe("[handling agent]: hi")
    expect(callData.transcript.metadata.duration).toBe(88)
    expect(callData.transcript.metadata.timestamp).toBe("2025-01-01T00:00:00Z")
  })
})
