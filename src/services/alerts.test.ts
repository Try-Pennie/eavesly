import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { dispatchAlerts, buildSlackPayload, buildFullQASlackPayload, buildSummary, lookupManagerEmail, formatDuration, buildReviewUrl } from "./alerts"
import type { Alert } from "../modules/types"
import type { Bindings } from "../types/env"
import { createEnv } from "../../test/helpers/mock-env"
import { VIOLATION_TYPES, MODULE_NAMES } from "../modules/constants"
import violationFixture from "../../test/fixtures/responses/full-qa-violation.json"
import budgetViolationFixture from "../../test/fixtures/responses/budget-inputs-violation.json"
import warmViolationFixture from "../../test/fixtures/responses/warm-transfer-violation.json"
import activeSettlementsDetected from "../../test/fixtures/responses/active-settlements-detected.json"
import activeSettlementsCompetitor from "../../test/fixtures/responses/active-settlements-with-competitor.json"
import gotaViolationFixture from "../../test/fixtures/responses/gota-check-violation.json"

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

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
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve("ok") }),
    )
    mockSingle.mockResolvedValue({
      data: { manager_email: "manager@example.com" },
      error: null,
    })
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

  it("POSTs full_qa alerts to SLACK_WEBHOOK_URL_FULL_QA", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({ result: violationFixture })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalledWith(
      env.SLACK_WEBHOOK_URL_FULL_QA,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
  })

  it("POSTs non-full_qa alerts to SLACK_WEBHOOK_URL", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalledWith(
      env.SLACK_WEBHOOK_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
  })

  it("sends full_qa payload shape to Slack", async () => {
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
    expect(body.manager_review_reason).toBe(violationFixture.call_overview.manager_review_reason)
    expect(body.overall_tone).toBe(violationFixture.call_overview.overall_tone)
    expect(body.call_outcome).toBe(violationFixture.call_overview.call_outcome)
    expect(body).toHaveProperty("compliance_violations")
    expect(body).toHaveProperty("areas_for_improvement")
    expect(body).toHaveProperty("specific_coaching_points")
  })

  it("skips webhook when SLACK_WEBHOOK_URL is not set for non-full_qa alerts", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ SLACK_WEBHOOK_URL: undefined })
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("skips webhook when SLACK_WEBHOOK_URL_FULL_QA is not set for full_qa alerts", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ SLACK_WEBHOOK_URL_FULL_QA: undefined })

    await dispatchAlerts([createAlert()], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("catches webhook errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error", text: () => Promise.resolve("server error") }),
    )
    const ctx = createMockCtx()
    const env = createEnv()

    await dispatchAlerts([createAlert()], ctx, env)
    // The .catch() in dispatchAlerts should handle the error
    await (ctx.waitUntil as any).mock.calls[0][0]
    // No throw — test passes if we get here
  })

  it("includes manager email in payload when agent has valid mapping", async () => {
    mockSingle.mockResolvedValue({
      data: { manager_email: "boss@example.com" },
      error: null,
    })
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "agent@example.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("boss@example.com")
  })

  it("sends empty manager email when agent not found in mapping", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } })
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "unknown@example.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("")
  })

  it("sends empty manager email when manager is 'NONE'", async () => {
    mockSingle.mockResolvedValue({
      data: { manager_email: "NONE" },
      error: null,
    })
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "agent@example.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("")
  })

  it("sends empty manager email when manager is 'No longer at Pennie'", async () => {
    mockSingle.mockResolvedValue({
      data: { manager_email: "No longer at Pennie" },
      error: null,
    })
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "agent@example.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("")
  })

  it("sends empty manager email when agent_email is undefined", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: undefined,
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("")
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("still sends alert when manager lookup throws an error", async () => {
    mockSingle.mockRejectedValue(new Error("DB connection failed"))
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "agent@example.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalled()
    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.manager_email).toBe("")
  })
})

describe("dispatchAlerts — Joel Nelson mirror", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve("ok") }),
    )
    mockSingle.mockResolvedValue({
      data: { manager_email: "manager@example.com" },
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("mirrors non-full_qa alerts for jnelson@trypennie.com to SLACK_WEBHOOK_URL_JOEL_NELSON", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "jnelson@trypennie.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const urls = (fetch as any).mock.calls.map((c: any[]) => c[0])
    expect(urls).toContain(env.SLACK_WEBHOOK_URL)
    expect(urls).toContain(env.SLACK_WEBHOOK_URL_JOEL_NELSON)
    expect(urls).not.toContain(env.SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON)
  })

  it("mirrors full_qa alerts for jnelson@trypennie.com to SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      agent_email: "jnelson@trypennie.com",
      result: violationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const urls = (fetch as any).mock.calls.map((c: any[]) => c[0])
    expect(urls).toContain(env.SLACK_WEBHOOK_URL_FULL_QA)
    expect(urls).toContain(env.SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON)
    expect(urls).not.toContain(env.SLACK_WEBHOOK_URL_JOEL_NELSON)
  })

  it("matches Joel Nelson case-insensitively", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "JNelson@TryPennie.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const urls = (fetch as any).mock.calls.map((c: any[]) => c[0])
    expect(urls).toContain(env.SLACK_WEBHOOK_URL_JOEL_NELSON)
  })

  it("mutes disposition-review Slack alerts for Joel Nelson while production testing", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.DISPOSITION_REVIEW,
      violation_type: VIOLATION_TYPES.MIS_DISPOSITION,
      agent_email: "jnelson@trypennie.com",
      result: {
        current_disposition: "Interested",
        suggested_disposition: "Not Interested",
      },
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("does NOT mirror alerts for other agents", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "someone-else@trypennie.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalledTimes(1)
    const urls = (fetch as any).mock.calls.map((c: any[]) => c[0])
    expect(urls).toContain(env.SLACK_WEBHOOK_URL)
    expect(urls).not.toContain(env.SLACK_WEBHOOK_URL_JOEL_NELSON)
    expect(urls).not.toContain(env.SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON)
  })

  it("skips mirror but still sends primary when SLACK_WEBHOOK_URL_JOEL_NELSON is unset", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ SLACK_WEBHOOK_URL_JOEL_NELSON: undefined })
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "jnelson@trypennie.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      env.SLACK_WEBHOOK_URL,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("primary send still succeeds when mirror send fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("joel-nelson")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("mirror failed"),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("ok"),
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      agent_email: "jnelson@trypennie.com",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    // Should not throw — mirror error is swallowed
    await (ctx.waitUntil as any).mock.calls[0][0]

    const urls = fetchMock.mock.calls.map((c: any[]) => c[0])
    expect(urls).toContain(env.SLACK_WEBHOOK_URL)
    expect(urls).toContain(env.SLACK_WEBHOOK_URL_JOEL_NELSON)
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
    expect(payload.manager_email).toBe("")
  })

  it("includes manager_email when passed explicitly", () => {
    const alert = createAlert({ call_id: "call-123" })
    const payload = buildSlackPayload(alert, "manager@example.com")
    expect(payload.manager_email).toBe("manager@example.com")
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

  it("defaults call_duration to empty string when not present", () => {
    const alert = createAlert({ call_id: "call-123" })
    const payload = buildSlackPayload(alert)
    expect(payload.call_duration).toBe("")
  })

  it("formats call_duration correctly when present", () => {
    const alert = createAlert({ call_id: "call-123", call_duration: 272 })
    const payload = buildSlackPayload(alert)
    expect(payload.call_duration).toBe("4m 32s")
  })

  it("populates evidence and detail for budget compliance", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      result: budgetViolationFixture,
    })
    const payload = buildSlackPayload(alert)

    expect(payload.evidence).toBe(budgetViolationFixture.key_evidence_quote)
    expect(payload.detail).toContain("❌ Not Collected")
    expect(payload.detail).toContain("✅ Collected")
    expect(payload.detail).toContain("Housing Insurance")
    expect(payload.detail).toContain("Housing Status")
    // Not-collected items appear before collected items
    const notCollectedIdx = payload.detail.indexOf("❌ Not Collected")
    const collectedIdx = payload.detail.indexOf("✅ Collected")
    expect(notCollectedIdx).toBeLessThan(collectedIdx)
  })
})

describe("buildSlackPayload — active_settlements", () => {
  it("surfaces enrolled_with_competitor and cancellation_confirmed at top level", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result: activeSettlementsCompetitor,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.enrolled_with_competitor).toBe("yes")
    expect(payload.cancellation_confirmed).toBe("yes")
  })

  it("populates secondary fields from detected fixture (no competitor)", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result: activeSettlementsDetected,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.enrolled_with_competitor).toBe("no")
    expect(payload.cancellation_confirmed).toBe("n/a")
  })

  it("leaves secondary fields empty for non-active_settlements alerts", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      result: budgetViolationFixture,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.enrolled_with_competitor).toBe("")
    expect(payload.cancellation_confirmed).toBe("")
  })

  it("includes mentions, agent response, and secondary checks in detail", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result: activeSettlementsCompetitor,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.detail).toContain("Settlement Mentions:")
    expect(payload.detail).toContain("Beyond Finance")
    expect(payload.detail).toContain("Agent Response:")
    expect(payload.detail).toContain("Enrolled with competitor: yes")
    expect(payload.detail).toContain("Cancellation confirmed: yes")
  })

  it("uses Active settlements label in summary", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result: activeSettlementsDetected,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.summary).toContain("Active settlements violation")
  })

  it("uses key_evidence_quote as evidence", () => {
    const alert = createAlert({
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      violation_type: VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result: activeSettlementsDetected,
    })
    const payload = buildSlackPayload(alert)
    expect(payload.evidence).toBe(activeSettlementsDetected.key_evidence_quote)
  })
})

describe("buildSlackPayload — gota_check", () => {
  function gotaAlert(result: unknown = gotaViolationFixture) {
    return createAlert({
      module_name: MODULE_NAMES.GOTA_CHECK,
      violation_type: VIOLATION_TYPES.GOTA_CHECK,
      result,
    })
  }

  it("uses Achieve GOTA label and violation_reason in summary", () => {
    const payload = buildSlackPayload(gotaAlert())
    expect(payload.summary).toContain("Achieve GOTA violation")
    expect(payload.summary).toContain(gotaViolationFixture.violation_reason)
  })

  it("uses key_evidence_quote as evidence", () => {
    const payload = buildSlackPayload(gotaAlert())
    expect(payload.evidence).toBe(gotaViolationFixture.key_evidence_quote)
  })

  it("detail names the GOTA gap, packet type, and WC transfer status", () => {
    const payload = buildSlackPayload(gotaAlert())
    expect(payload.detail).toContain("GOTA walkthrough conducted: NO")
    expect(payload.detail).toContain("Agreement packet: Unknown")
    expect(payload.detail).toContain("Welcome-call transfer on this call: yes")
    expect(payload.detail).toContain(`Signing confirmed: "${gotaViolationFixture.enrollment_evidence_quote}"`)
  })

  it("detail lists missing walkthrough beats when present", () => {
    const payload = buildSlackPayload(
      gotaAlert({ ...gotaViolationFixture, missing_beats: ["Banking details read-back", "SSN verification"] }),
    )
    expect(payload.detail).toContain("Missing walkthrough beats:")
    expect(payload.detail).toContain("- Banking details read-back")
    expect(payload.detail).toContain("- SSN verification")
  })

  it("detail shows required-disclosure compliance and lists missing disclosures", () => {
    const payload = buildSlackPayload(
      gotaAlert({
        ...gotaViolationFixture,
        missing_required_disclosures: ["Tax consequences / IRS reporting"],
      }),
    )
    expect(payload.detail).toContain("Required disclosures compliant: NO")
    expect(payload.detail).toContain("Required disclosures in order: NO")
    expect(payload.detail).toContain("Missing/noncompliant required disclosures:")
    expect(payload.detail).toContain("- Tax consequences / IRS reporting")
  })

  it("detail labels the Turnbull packet for red-state walkthroughs", () => {
    const payload = buildSlackPayload(gotaAlert({ ...gotaViolationFixture, gota_type: "turnbull_red" }))
    expect(payload.detail).toContain("Turnbull Law Group (red / legal-model state)")
  })

  it("detail labels the California two-step FDR packet", () => {
    const payload = buildSlackPayload(gotaAlert({ ...gotaViolationFixture, gota_type: "fdr_california" }))
    expect(payload.detail).toContain("Freedom Debt Relief (California two-step)")
  })
})

describe("buildFullQASlackPayload", () => {
  it("extracts all fields from a full_qa violation result", () => {
    const alert = createAlert({
      call_id: "call-123",
      agent_email: "agent@example.com",
      contact_name: "John Doe",
      sfdc_lead_id: "00Q123",
      call_duration: 300,
      recording_link: "https://recording.example.com/123",
      transcript_url: "https://transcript.example.com/123",
      result: violationFixture,
    })
    const payload = buildFullQASlackPayload(alert, "manager@example.com")

    expect(payload.manager_review_reason).toBe(violationFixture.call_overview.manager_review_reason)
    expect(payload.agent_email).toBe("agent@example.com")
    expect(payload.manager_email).toBe("manager@example.com")
    expect(payload.call_id).toBe("call-123")
    expect(payload.sfdc_lead_id).toBe("00Q123")
    expect(payload.contact_name).toBe("John Doe")
    expect(payload.call_duration).toBe("5m 0s")
    expect(payload.overall_tone).toBe(violationFixture.call_overview.overall_tone)
    expect(payload.call_outcome).toBe(violationFixture.call_overview.call_outcome)
    expect(payload.compliance_violations).toBe(violationFixture.compliance_scorecard.compliance_violations.join("\n"))
    expect(payload.areas_for_improvement).toBe(violationFixture.coaching_recommendations.areas_for_improvement.join("\n"))
    expect(payload.specific_coaching_points).toBe(violationFixture.coaching_recommendations.specific_coaching_points.join("\n"))
    expect(payload.transcript_url).toBe("https://transcript.example.com/123")
    expect(payload.recording_link).toBe("https://recording.example.com/123")
  })

  it("defaults all fields gracefully when result is empty", () => {
    const alert = createAlert({ result: {} })
    const payload = buildFullQASlackPayload(alert)

    expect(payload.manager_review_reason).toBe("")
    expect(payload.manager_email).toBe("")
    expect(payload.overall_tone).toBe("")
    expect(payload.call_outcome).toBe("")
    expect(payload.compliance_violations).toBe("")
    expect(payload.areas_for_improvement).toBe("")
    expect(payload.specific_coaching_points).toBe("")
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

describe("buildReviewUrl", () => {
  it("returns empty string when DASHBOARD_BASE_URL is not set", () => {
    const env = createEnv({ DASHBOARD_BASE_URL: undefined })
    expect(buildReviewUrl(env, "call-1", "full_qa")).toBe("")
  })

  it("builds the dashboard deep link when base URL is set", () => {
    const env = createEnv({ DASHBOARD_BASE_URL: "https://eavesly.com" })
    expect(buildReviewUrl(env, "call-1", "full_qa")).toBe(
      "https://eavesly.com/dashboard/alerts/call-1/full_qa",
    )
  })

  it("strips trailing slashes from the base URL", () => {
    const env = createEnv({ DASHBOARD_BASE_URL: "https://eavesly.com/" })
    expect(buildReviewUrl(env, "call-1", "full_qa")).toBe(
      "https://eavesly.com/dashboard/alerts/call-1/full_qa",
    )
  })

  it("URL-encodes special characters in the call id", () => {
    const env = createEnv({ DASHBOARD_BASE_URL: "https://eavesly.com" })
    expect(buildReviewUrl(env, "call/with spaces", "full_qa")).toBe(
      "https://eavesly.com/dashboard/alerts/call%2Fwith%20spaces/full_qa",
    )
  })
})

describe("review_url propagation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve("ok") }),
    )
    mockSingle.mockResolvedValue({
      data: { manager_email: "manager@example.com" },
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("includes review_url in non-full_qa Slack payload when DASHBOARD_BASE_URL is set", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ DASHBOARD_BASE_URL: "https://eavesly.com" })
    const alert = createAlert({
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
      call_id: "call-xyz",
      result: budgetViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.review_url).toBe(
      "https://eavesly.com/dashboard/alerts/call-xyz/budget_inputs",
    )
  })

  it("includes review_url in full_qa Slack payload when DASHBOARD_BASE_URL is set", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ DASHBOARD_BASE_URL: "https://eavesly.com" })
    const alert = createAlert({
      call_id: "call-abc",
      result: violationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.review_url).toBe(
      "https://eavesly.com/dashboard/alerts/call-abc/full_qa",
    )
  })

  it("sends empty review_url when DASHBOARD_BASE_URL is not set", async () => {
    const ctx = createMockCtx()
    const env = createEnv({ DASHBOARD_BASE_URL: undefined })
    const alert = createAlert({ result: violationFixture })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.review_url).toBe("")
  })

  it("buildSlackPayload accepts an explicit reviewUrl arg", () => {
    const alert = createAlert({ call_id: "call-1" })
    const payload = buildSlackPayload(alert, "manager@example.com", "https://eavesly.com/dashboard/alerts/call-1/full_qa")
    expect(payload.review_url).toBe(
      "https://eavesly.com/dashboard/alerts/call-1/full_qa",
    )
  })

  it("buildFullQASlackPayload accepts an explicit reviewUrl arg", () => {
    const alert = createAlert({ call_id: "call-1", result: violationFixture })
    const payload = buildFullQASlackPayload(alert, "manager@example.com", "https://eavesly.com/dashboard/alerts/call-1/full_qa")
    expect(payload.review_url).toBe(
      "https://eavesly.com/dashboard/alerts/call-1/full_qa",
    )
  })

  it("payload review_url defaults to empty string when not passed", () => {
    const alert = createAlert({ call_id: "call-1" })
    expect(buildSlackPayload(alert).review_url).toBe("")
    expect(buildFullQASlackPayload(alert).review_url).toBe("")
  })
})

describe("formatDuration", () => {
  it("returns empty string for undefined", () => {
    expect(formatDuration(undefined)).toBe("")
  })

  it("returns empty string for negative values", () => {
    expect(formatDuration(-1)).toBe("")
  })

  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("0m 0s")
  })

  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("0m 45s")
  })

  it("formats minutes and seconds", () => {
    expect(formatDuration(272)).toBe("4m 32s")
  })

  it("formats exact minutes", () => {
    expect(formatDuration(120)).toBe("2m 0s")
  })
})

describe("Achieve module alert suppression", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve("ok") }),
    )
    mockSingle.mockResolvedValue({
      data: { manager_email: "manager@example.com" },
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("mutes Slack alerts for achieve_welcome_call_qa module — no manager routing", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      violation_type: VIOLATION_TYPES.ACHIEVE_WELCOME_CALL,
      agent_email: "agent@achieve.com",
      result: { partner_id: "achieve", script_version: "fdr_wholesale_db_pilot_v0" },
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("mutes Slack alerts for gota_check during soft launch (module_name)", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: MODULE_NAMES.GOTA_CHECK,
      violation_type: VIOLATION_TYPES.GOTA_CHECK,
      agent_email: "agent@trypennie.com",
      result: gotaViolationFixture,
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("mutes gota_check by violation_type alone during soft launch", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: "some_other_name",
      violation_type: VIOLATION_TYPES.GOTA_CHECK,
      result: {},
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  it("mutes by violation_type alone (achieve_welcome_call)", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alert = createAlert({
      module_name: "some_other_name",
      violation_type: VIOLATION_TYPES.ACHIEVE_WELCOME_CALL,
      result: {},
    })

    await dispatchAlerts([alert], ctx, env)
    await (ctx.waitUntil as any).mock.calls[0][0]

    expect(fetch).not.toHaveBeenCalled()
  })

  // Regression guard: the combined PSC + GOTA work must NOT unmute either
  // Achieve mute. Both the gota_check soft-launch mute and the external
  // achieve_welcome_call_qa mute must keep suppressing Slack.
  it("keeps BOTH the gota_check and achieve_welcome_call_qa Slack mutes", async () => {
    const ctx = createMockCtx()
    const env = createEnv()
    const alerts = [
      createAlert({
        module_name: MODULE_NAMES.GOTA_CHECK,
        violation_type: VIOLATION_TYPES.GOTA_CHECK,
        agent_email: "agent@trypennie.com",
        result: gotaViolationFixture,
      }),
      createAlert({
        module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
        violation_type: VIOLATION_TYPES.ACHIEVE_WELCOME_CALL,
        agent_email: "agent@achieve.com",
        result: {},
      }),
    ]

    await dispatchAlerts(alerts, ctx, env)
    for (const call of (ctx.waitUntil as any).mock.calls) {
      await call[0]
    }

    expect(fetch).not.toHaveBeenCalled()
  })
})
