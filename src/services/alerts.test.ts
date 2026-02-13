import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { dispatchAlerts, buildSlackPayload, buildSummary } from "./alerts"
import type { Alert } from "../modules/types"
import type { Bindings } from "../types/env"
import { createEnv } from "../../test/helpers/mock-env"
import { VIOLATION_TYPES, MODULE_NAMES } from "../modules/constants"
import violationFixture from "../../test/fixtures/responses/full-qa-violation.json"
import budgetViolationFixture from "../../test/fixtures/responses/budget-inputs-violation.json"
import warmViolationFixture from "../../test/fixtures/responses/warm-transfer-violation.json"

function createMockCtx() {
  return {
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext
}

function createAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    module_name: MODULE_NAMES.FULL_QA,
    violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
    call_id: "call-1",
    agent_id: "agent-1",
    result: {},
    ...overrides,
  }
}

describe("dispatchAlerts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("calls waitUntil for each alert", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alerts: Alert[] = [
      createAlert({ call_id: "call-1" }),
      createAlert({
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
        call_id: "call-2",
      }),
    ]

    await dispatchAlerts(alerts, ctx, env)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2)
  })

  it("handles empty alerts array", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    await dispatchAlerts([], ctx, env)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it("passes a promise to waitUntil", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    await dispatchAlerts([createAlert()], ctx, env)
    const passedArg = (ctx.waitUntil as any).mock.calls[0][0]
    expect(passedArg).toBeInstanceOf(Promise)
  })

  it("POSTs to Slack webhook when URL is set", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({ result: violationFixture })

    await dispatchAlerts([alert], ctx, env)
    // waitUntil captures the promise; resolve it
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalledWith(
      env.SLACK_WEBHOOK_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
  })

  it("sends correct payload shape to Slack", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      call_id: "call-abc",
      agent_id: "agent-xyz",
      result: violationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.call_id).toBe("call-abc")
    expect(body.module_name).toBe(MODULE_NAMES.FULL_QA)
    expect(body.violation_type).toBe(VIOLATION_TYPES.MANAGER_ESCALATION)
    expect(body.summary).toContain("call-abc")
    expect(body.timestamp).toBeTruthy()
    expect(body).toHaveProperty("evidence")
    expect(body).toHaveProperty("detail")
  })

  it("skips webhook when SLACK_WEBHOOK_URL is not set", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ SLACK_WEBHOOK_URL: undefined })

    await dispatchAlerts([createAlert()], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("catches webhook errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" }),
    )
    const ctx = createMockCtx()
    const env = createEnv()

    await dispatchAlerts([createAlert()], ctx, env)
    // The .catch() in dispatchAlerts should handle the error
    await (ctx.waitUntil as any).mock.calls[0][0]
    // No throw — test passes if we get here
  })
})

describe("buildSlackPayload", () => {
  it("includes all required fields", () => {
    const alert = createAlert({
      call_id: "call-123",
      agent_id: "agent-456",
      result: violationFixture,
    })
    const payload = buildSlackPayload(alert)

    expect(payload.call_id).toBe("call-123")
    expect(payload.module_name).toBe(MODULE_NAMES.FULL_QA)
    expect(payload.violation_type).toBe(VIOLATION_TYPES.MANAGER_ESCALATION)
    expect(payload.summary).toBeTruthy()
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(payload).toHaveProperty("evidence")
    expect(payload).toHaveProperty("detail")
  })

  it("includes enriched Regal context fields when present", () => {
    const alert = createAlert({
      call_id: "call-123",
      agent_id: "agent-456",
      result: violationFixture,
      agent_email: "agent@example.com",
      contact_name: "John Doe",
      recording_link: "https://recordings.example.com/call-123",
      transcript_url: "https://transcripts.example.com/call-123",
      sfdc_lead_id: "00Q1234567890AB",
    })
    const payload = buildSlackPayload(alert)

    expect(payload.agent_email).toBe("agent@example.com")
    expect(payload.contact_name).toBe("John Doe")
    expect(payload.recording_link).toBe("https://recordings.example.com/call-123")
    expect(payload.transcript_url).toBe("https://transcripts.example.com/call-123")
    expect(payload.sfdc_lead_id).toBe("00Q1234567890AB")
  })

  it("defaults Regal context fields to empty string when not present", () => {
    const alert = createAlert({
      call_id: "call-123",
      agent_id: "agent-456",
      result: violationFixture,
    })
    const payload = buildSlackPayload(alert)

    expect(payload.agent_email).toBe("")
    expect(payload.contact_name).toBe("")
    expect(payload.recording_link).toBe("")
    expect(payload.transcript_url).toBe("")
    expect(payload.sfdc_lead_id).toBe("")
  })

  it("populates evidence and detail for budget compliance", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      result: budgetViolationFixture,
    })
    const payload = buildSlackPayload(alert)

    expect(payload.evidence).toBe(budgetViolationFixture.key_evidence_quote)
    expect(payload.detail).toContain("Housing Status: collected")
    expect(payload.detail).toContain("Housing Insurance: skipped")
  })
})

describe("buildSummary", () => {
  it("builds manager escalation summary with reason", () => {
    const alert = createAlert({ result: violationFixture })
    const summary = buildSummary(alert)

    expect(summary).toContain("Manager escalation violation")
    expect(summary).toContain("call-1")
    expect(summary).toContain(
      violationFixture.call_overview.manager_review_reason,
    )
  })

  it("builds budget compliance summary with violation reason", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      result: budgetViolationFixture,
    })
    const summary = buildSummary(alert)

    expect(summary).toContain("Budget compliance violation")
    expect(summary).toContain(budgetViolationFixture.violation_reason)
  })

  it("builds warm transfer summary with violation reason", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.WARM_TRANSFER,
      violation_type: VIOLATION_TYPES.WARM_TRANSFER,
      result: warmViolationFixture,
    })
    const summary = buildSummary(alert)

    expect(summary).toContain("Warm transfer violation")
    expect(summary).toContain(
      warmViolationFixture.warm_transfer_compliance.violation_reason,
    )
  })

  it("falls back gracefully when result fields are missing", () => {
    const alert = createAlert({ result: {} })
    const summary = buildSummary(alert)

    expect(summary).toContain("Manager escalation violation")
    expect(summary).toContain("Manager review required")
  })
})
