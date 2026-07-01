import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { createEvaluateRequest } from "../../test/helpers/create-request"
import { MODULE_NAMES } from "../modules/constants"
import { shouldRouteToAchieve, routeAchieveWelcomeCallQA } from "./achieve-routing"

describe("shouldRouteToAchieve()", () => {
  it("routes achieve + resolved", () => {
    expect(shouldRouteToAchieve({ partner_assignment: "achieve", assignment_status: "resolved" })).toBe(true)
  })

  it("does not route ambiguous null partner_assignment even if resolved", () => {
    expect(shouldRouteToAchieve({ partner_assignment: null, assignment_status: "resolved" })).toBe(false)
  })

  it("does not route achieve when not resolved", () => {
    expect(shouldRouteToAchieve({ partner_assignment: "achieve", assignment_status: null })).toBe(false)
    expect(shouldRouteToAchieve({ partner_assignment: "achieve", assignment_status: "unassigned" })).toBe(false)
  })

  it("does not route non-achieve partners", () => {
    expect(shouldRouteToAchieve({ partner_assignment: "beyond", assignment_status: "resolved" })).toBe(false)
  })

  it("does not route when no assignment row exists", () => {
    expect(shouldRouteToAchieve(null)).toBe(false)
  })
})

describe("routeAchieveWelcomeCallQA()", () => {
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

    await routeAchieveWelcomeCallQA(env, db, callData, correlationId)

    expect(db.getAgentRegalAssignment).toHaveBeenCalledWith("a@achieve.com")
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0][0]
    expect(args.id).toBe(`c-1-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`)
    expect(args.params.moduleName).toBe(MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)
    expect(args.params.callData).toBe(callData)
    expect(args.params.correlationId).toBe(correlationId)
  })

  it("falls back to eavesly_calls agent_email when callData.agent_email is absent", async () => {
    db.getCallContext.mockResolvedValue({ agent_email: "  FALLBACK@ACHIEVE.COM " })
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    const callData = createEvaluateRequest({ call_id: "c-2", agent_email: undefined })

    await routeAchieveWelcomeCallQA(env, db, callData, correlationId)

    expect(db.getCallContext).toHaveBeenCalledWith("c-2")
    expect(db.getAgentRegalAssignment).toHaveBeenCalledWith("fallback@achieve.com")
    expect(create).toHaveBeenCalledOnce()
  })

  it("does not route when no agent_email can be resolved", async () => {
    db.getCallContext.mockResolvedValue(null)
    const callData = createEvaluateRequest({ agent_email: undefined })

    await routeAchieveWelcomeCallQA(env, db, callData, correlationId)

    expect(db.getAgentRegalAssignment).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not route ambiguous / non-resolved agents", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: null, assignment_status: "resolved" })
    const callData = createEvaluateRequest({ agent_email: "ambiguous@x.com" })

    await routeAchieveWelcomeCallQA(env, db, callData, correlationId)

    expect(create).not.toHaveBeenCalled()
  })

  it("swallows 'already exists' so duplicate warm_transfer retries don't fail", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("instance with id ... already exists"))
    const callData = createEvaluateRequest({ agent_email: "a@achieve.com" })

    await expect(routeAchieveWelcomeCallQA(env, db, callData, correlationId)).resolves.toBeUndefined()
  })

  it("rethrows unexpected create errors", async () => {
    db.getAgentRegalAssignment.mockResolvedValue({ partner_assignment: "achieve", assignment_status: "resolved" })
    create.mockRejectedValue(new Error("network down"))
    const callData = createEvaluateRequest({ agent_email: "a@achieve.com" })

    await expect(routeAchieveWelcomeCallQA(env, db, callData, correlationId)).rejects.toThrow("network down")
  })
})
