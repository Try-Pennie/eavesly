import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { createEvaluateRequest } from "../../test/helpers/create-request"
import { MODULE_NAMES } from "../modules/constants"
import { shouldRouteToPartner, routePartnerFollowup, isAchieveWelcomeCallEligible, isAchieveGotaCheckEligible } from "./partner-routing"

const ACHIEVE_POLICY = {
  enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
  achieveMinDurationSeconds: 300,
}
const withCallMeta = (duration: number, disposition?: string, transcript = "x") =>
  createEvaluateRequest({
    transcript: { transcript, metadata: { duration, timestamp: "2025-01-01T00:00:00Z", disposition } },
  })

const GRADEABLE_WELCOME_CALL = [
  "[handling agent]: I will connect you to the welcome team now.",
  "[transfer agent]: My name is Sam with Freedom Debt Relief.",
  "[contact]: Yes, I am ready.",
  "[transfer agent]: Welcome to your program. Let us get you started.",
].join("\n")

const COMPETITOR_TRANSFER = [
  "[handling agent]: I will connect you to the welcome team now.",
  "[transfer agent]: Thank you for calling Beyond Finance.",
].join("\n")

const UNBOUNDED_WELCOME_CALL = [
  "IVR: Thank you for calling the Freedom Debt Relief disclosure line.",
  "Rep: My name is Sam with Freedom Debt Relief.",
  "Rep: Welcome to your program. Let us get you started.",
].join("\n")

describe("shouldRouteToPartner()", () => {
  it("routes when scalar partner matches and resolved", () => {
    expect(shouldRouteToPartner({ partner_assignment: "achieve", assignment_status: "resolved" }, "achieve")).toBe(true)
    expect(shouldRouteToPartner({ partner_assignment: "beyond", assignment_status: "resolved" }, "beyond")).toBe(true)
  })

  it("does not route ambiguous null partner_assignment even if resolved", () => {
    expect(shouldRouteToPartner({ partner_assignment: null, assignment_status: "resolved" }, "achieve")).toBe(false)
    expect(shouldRouteToPartner({ partner_assignment: null, assignment_status: "resolved" }, "beyond")).toBe(false)
  })

  it("does not route when not resolved", () => {
    expect(shouldRouteToPartner({ partner_assignment: "achieve", assignment_status: null }, "achieve")).toBe(false)
    expect(shouldRouteToPartner({ partner_assignment: "beyond", assignment_status: "unassigned" }, "beyond")).toBe(false)
  })

  it("does not route a different partner", () => {
    expect(shouldRouteToPartner({ partner_assignment: "beyond", assignment_status: "resolved" }, "achieve")).toBe(false)
    expect(shouldRouteToPartner({ partner_assignment: "achieve", assignment_status: "resolved" }, "beyond")).toBe(false)
  })

  it("does not route when no assignment row exists", () => {
    expect(shouldRouteToPartner(null, "achieve")).toBe(false)
    expect(shouldRouteToPartner(null, "beyond")).toBe(false)
  })
})

describe("isAchieveWelcomeCallEligible()", () => {
  it("uses a gradeable production segment as authoritative over stale disposition and duration", () => {
    const result = isAchieveWelcomeCallEligible(
      withCallMeta(45, "2.1 - Something else", GRADEABLE_WELCOME_CALL),
      ACHIEVE_POLICY,
    )

    expect(result).toEqual({
      eligible: true,
      reason: "strong_transcript_evidence",
      assignment: "override",
      segment: {
        found: true,
        skipReason: null,
        confidence: "high",
        marker: "live_welcome_agent",
      },
    })
  })

  it("eligible: enrollment disposition and duration over the minimum", () => {
    const r = isAchieveWelcomeCallEligible(withCallMeta(301, ACHIEVE_POLICY.enrollmentDisposition), ACHIEVE_POLICY)
    expect(r.eligible).toBe(true)
  })

  it("treats Turnbull Pending as metadata eligible", () => {
    const result = isAchieveWelcomeCallEligible(
      withCallMeta(301, "1.3B - Turnbull Pending"),
      ACHIEVE_POLICY,
    )

    expect(result.eligible).toBe(true)
    expect(result.reason).toBe("metadata_eligible")
    expect(result.assignment).toBe("require_match")
  })

  it("eligible: 13-minute welcome-call transfers (previously excluded by the 30-min floor)", () => {
    expect(isAchieveWelcomeCallEligible(withCallMeta(780, ACHIEVE_POLICY.enrollmentDisposition), ACHIEVE_POLICY).eligible).toBe(true)
    expect(isAchieveWelcomeCallEligible(withCallMeta(1109, ACHIEVE_POLICY.enrollmentDisposition), ACHIEVE_POLICY).eligible).toBe(true)
  })

  it("returns duration_ineligible at or below the minimum (dial legs / instant hangups)", () => {
    const atThreshold = isAchieveWelcomeCallEligible(
      withCallMeta(300, ACHIEVE_POLICY.enrollmentDisposition),
      ACHIEVE_POLICY,
    )

    expect(atThreshold.eligible).toBe(false)
    expect(atThreshold.reason).toBe("duration_ineligible")
    expect(isAchieveWelcomeCallEligible(
      withCallMeta(45, ACHIEVE_POLICY.enrollmentDisposition),
      ACHIEVE_POLICY,
    ).reason).toBe("duration_ineligible")
  })

  it("ineligible: wrong or missing disposition even when long enough", () => {
    expect(isAchieveWelcomeCallEligible(withCallMeta(3000, "2.1 - Something else"), ACHIEVE_POLICY).eligible).toBe(false)
    expect(isAchieveWelcomeCallEligible(withCallMeta(3000, undefined), ACHIEVE_POLICY).eligible).toBe(false)
  })

  it.each([
    ["competitor transfer", COMPETITOR_TRANSFER, "competitor_transfer"],
    ["unbounded welcome call", UNBOUNDED_WELCOME_CALL, "unbounded_label_less"],
    ["no welcome evidence", "ordinary Pennie call", "no_transfer_leg"],
  ])("fails closed for %s when metadata is not eligible", (_label, transcript, skipReason) => {
    const result = isAchieveWelcomeCallEligible(
      withCallMeta(45, "2.1 - Something else", transcript),
      ACHIEVE_POLICY,
    )

    expect(result.eligible).toBe(false)
    expect(result.reason).toBe("disposition_ineligible")
    expect(result.segment).toEqual(expect.objectContaining({ found: false, skipReason }))
  })
})

const GOTA_POLICY = {
  enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
  enrollmentMinDurationSeconds: 1200,
}

describe("isAchieveGotaCheckEligible()", () => {
  it("eligible: enrollment disposition and duration over the enrollment minimum", () => {
    const r = isAchieveGotaCheckEligible(withCallMeta(1201, GOTA_POLICY.enrollmentDisposition), GOTA_POLICY)
    expect(r.eligible).toBe(true)
  })

  it("ineligible: duration at or below the enrollment minimum", () => {
    expect(isAchieveGotaCheckEligible(withCallMeta(1200, GOTA_POLICY.enrollmentDisposition), GOTA_POLICY).eligible).toBe(false)
    expect(isAchieveGotaCheckEligible(withCallMeta(300, GOTA_POLICY.enrollmentDisposition), GOTA_POLICY).eligible).toBe(false)
  })

  it("ineligible: wrong or missing disposition even when long enough", () => {
    expect(isAchieveGotaCheckEligible(withCallMeta(3000, "2.1 - Something else"), GOTA_POLICY).eligible).toBe(false)
    expect(isAchieveGotaCheckEligible(withCallMeta(3000, undefined), GOTA_POLICY).eligible).toBe(false)
  })
})

const ACHIEVE = { partner: "achieve", moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA }
const BEYOND = { partner: "beyond", moduleName: MODULE_NAMES.BUDGET_INPUTS }

describe("routePartnerFollowup()", () => {
  const correlationId = "corr-1"
  let create: ReturnType<typeof vi.fn>
  let env: ReturnType<typeof createEnv>
  let db: any

  beforeEach(() => {
    create = vi.fn().mockResolvedValue({ id: "x" })
    env = createEnv({ EVALUATION_WORKFLOW: { create, get: vi.fn() } as any })
    db = {
      getCallContext: vi.fn(),
      getAgentRegalAssignment: vi.fn(),
    }
  })

  it("chains achieve_welcome_call_qa when agent is resolved to Achieve", async () => {
    env.ENVIRONMENT = "production"
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-1", agent_email: "  A@ACHIEVE.COM " })

    await routePartnerFollowup(env, db, callData, correlationId, ACHIEVE)

    expect(db.getAgentRegalAssignment).toHaveBeenCalledWith("a@achieve.com")
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0][0]
    expect(args.id).toBe(`c-1-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`)
    expect(args.params.moduleName).toBe(MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
    expect(args.params.callData).toBe(callData)
    expect(args.params.correlationId).toBe(correlationId)
    expect(args.retention).toEqual({
      successRetention: "7 days",
      errorRetention: "14 days",
    })
  })

  it("skips the achieve follow-up when the eligibility gate fails, before any DB lookup", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ agent_email: "a@achieve.com" })
    const eligibility = () => ({ eligible: false, reason: "duration 45s <= 300s" })

    await routePartnerFollowup(env, db, callData, correlationId, { ...ACHIEVE, eligibility })

    expect(create).not.toHaveBeenCalled()
    expect(db.getAgentRegalAssignment).not.toHaveBeenCalled()
  })

  it("chains the achieve follow-up when the eligibility gate passes and agent is resolved", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-ok", agent_email: "a@achieve.com" })
    const eligibility = () => ({ eligible: true, reason: "eligible" })

    await routePartnerFollowup(env, db, callData, correlationId, { ...ACHIEVE, eligibility })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0].id).toBe(`c-ok-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`)
  })

  it("routes strong transcript evidence without disposition despite a stale current partner assignment", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = withCallMeta(45, undefined, GRADEABLE_WELCOME_CALL)
    const eligibility = (request: typeof callData) => isAchieveWelcomeCallEligible(request, ACHIEVE_POLICY)

    const result = await routePartnerFollowup(env, db, callData, correlationId, { ...ACHIEVE, eligibility })

    expect(result).toEqual({
      status: "routed",
      reason: "assignment_override",
      eligibilityReason: "strong_transcript_evidence",
      instanceId: `test-call-123-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`,
    })
    expect(db.getAgentRegalAssignment).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledOnce()
  })

  it("routes a metadata-eligible failed handoff so the QA module can record its deterministic skip", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = withCallMeta(301, ACHIEVE_POLICY.enrollmentDisposition, COMPETITOR_TRANSFER)
    const eligibility = (request: typeof callData) => isAchieveWelcomeCallEligible(request, ACHIEVE_POLICY)

    const result = await routePartnerFollowup(env, db, callData, correlationId, { ...ACHIEVE, eligibility })

    expect(result).toEqual({
      status: "routed",
      reason: "assignment_match",
      eligibilityReason: "metadata_eligible",
      instanceId: `test-call-123-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`,
    })
    expect(db.getAgentRegalAssignment).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it("does not let competitor evidence override a different partner assignment", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = withCallMeta(301, ACHIEVE_POLICY.enrollmentDisposition, COMPETITOR_TRANSFER)
    const eligibility = (request: typeof callData) => isAchieveWelcomeCallEligible(request, ACHIEVE_POLICY)

    const result = await routePartnerFollowup(env, db, callData, correlationId, { ...ACHIEVE, eligibility })

    expect(result).toEqual({ status: "skipped", reason: "assignment_mismatch" })
    expect(create).not.toHaveBeenCalled()
  })

  it("chains budget_inputs when agent is resolved to Beyond", async () => {
    env.ENVIRONMENT = "development"
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-9", agent_email: "  B@BEYOND.COM " })

    await routePartnerFollowup(env, db, callData, correlationId, BEYOND)

    expect(db.getAgentRegalAssignment).toHaveBeenCalledWith("b@beyond.com")
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0][0]
    expect(args.id).toBe(`c-9-${MODULE_NAMES.BUDGET_INPUTS}`)
    expect(args.params.moduleName).toBe(MODULE_NAMES.BUDGET_INPUTS)
    expect(args.params.callData).toBe(callData)
    expect(args.params.correlationId).toBe(correlationId)
    expect(args.retention).toEqual({
      successRetention: "1 day",
      errorRetention: "3 days",
    })
  })

  it("does not route budget_inputs for an Achieve-resolved agent", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ agent_email: "a@achieve.com" })

    await routePartnerFollowup(env, db, callData, correlationId, BEYOND)

    expect(create).not.toHaveBeenCalled()
  })

  it("does not route achieve_welcome_call_qa for a Beyond-resolved agent", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ agent_email: "b@beyond.com" })

    await routePartnerFollowup(env, db, callData, correlationId, ACHIEVE)

    expect(create).not.toHaveBeenCalled()
  })

  it("falls back to eavesly_calls agent_email when callData.agent_email is absent", async () => {
    db.getCallContext.mockResolvedValue({ agent_email: "  FALLBACK@BEYOND.COM " })
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-2", agent_email: undefined })

    await routePartnerFollowup(env, db, callData, correlationId, BEYOND)

    expect(db.getCallContext).toHaveBeenCalledWith("c-2")
    expect(db.getAgentRegalAssignment).toHaveBeenCalledWith("fallback@beyond.com")
    expect(create).toHaveBeenCalledOnce()
  })

  it("does not route when no agent_email can be resolved", async () => {
    db.getCallContext.mockResolvedValue(null)
    const callData = createEvaluateRequest({ agent_email: undefined })

    await routePartnerFollowup(env, db, callData, correlationId, BEYOND)

    expect(db.getAgentRegalAssignment).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not route ambiguous / non-resolved agents", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: null, assignment_status: "resolved" })
    const callData = createEvaluateRequest({ agent_email: "ambiguous@x.com" })

    await routePartnerFollowup(env, db, callData, correlationId, BEYOND)

    expect(create).not.toHaveBeenCalled()
  })

  it("logs a warn-level routing gap when the agent has no assignment record (null)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    db.getAgentRegalAssignment.mockResolvedValue(null)
    const callData = createEvaluateRequest({ call_id: "c-gap", agent_email: "missing@achieve.com" })

    await routePartnerFollowup(env, db, callData, correlationId, ACHIEVE)

    expect(create).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    const entry = JSON.parse(warn.mock.calls[0][0] as string)
    expect(entry.level).toBe("warn")
    expect(entry.message).toBe("Partner routing gap: agent has no assignment record")
    expect(entry.callId).toBe("c-gap")
    expect(entry.agentEmail).toBe("missing@achieve.com")
    expect(entry.partner).toBe("achieve")
    warn.mockRestore()
    info.mockRestore()
  })

  it("logs at info (not warn) when a record exists but assignment_status is not resolved", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "unassigned" })
    const callData = createEvaluateRequest({ call_id: "c-unres", agent_email: "a@achieve.com" })

    await routePartnerFollowup(env, db, callData, correlationId, ACHIEVE)

    expect(create).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledOnce()
    const entry = JSON.parse(info.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("Partner routing skipped: agent assignment not resolved")
    expect(entry.assignmentStatus).toBe("unassigned")
    warn.mockRestore()
    info.mockRestore()
  })

  it("logs at info (not warn) when the agent is resolved to a different partner", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-wrong", agent_email: "b@beyond.com" })

    await routePartnerFollowup(env, db, callData, correlationId, ACHIEVE)

    expect(create).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledOnce()
    const entry = JSON.parse(info.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("Partner routing skipped: agent assigned to different partner")
    expect(entry.actualPartnerAssignment).toBe("beyond")
    warn.mockRestore()
    info.mockRestore()
  })

  it("swallows 'already exists' so duplicate budget_inputs retries don't fail", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("instance with id ... already exists"))
    const callData = createEvaluateRequest({ agent_email: "b@beyond.com" })

    await expect(routePartnerFollowup(env, db, callData, correlationId, BEYOND)).resolves.toEqual({
      status: "skipped",
      reason: "already_enqueued",
    })
  })

  it("rethrows unexpected create errors", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("network down"))
    const callData = createEvaluateRequest({ agent_email: "b@beyond.com" })

    await expect(routePartnerFollowup(env, db, callData, correlationId, BEYOND)).rejects.toThrow("network down")
  })
})
