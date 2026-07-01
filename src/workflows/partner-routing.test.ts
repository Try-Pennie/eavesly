import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { createEvaluateRequest } from "../../test/helpers/create-request"
import { MODULE_NAMES } from "../modules/constants"
import { shouldRouteToPartner, routePartnerFollowup } from "./partner-routing"

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
  })

  it("chains budget_inputs when agent is resolved to Beyond", async () => {
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

  it("swallows 'already exists' so duplicate budget_inputs retries don't fail", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("instance with id ... already exists"))
    const callData = createEvaluateRequest({ agent_email: "b@beyond.com" })

    await expect(routePartnerFollowup(env, db, callData, correlationId, BEYOND)).resolves.toBeUndefined()
  })

  it("rethrows unexpected create errors", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "beyond", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("network down"))
    const callData = createEvaluateRequest({ agent_email: "b@beyond.com" })

    await expect(routePartnerFollowup(env, db, callData, correlationId, BEYOND)).rejects.toThrow("network down")
  })
})
