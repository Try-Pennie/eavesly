import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

const recordRegalCallEvent = vi.fn().mockResolvedValue(undefined)
const getRegalCallEvents = vi.fn()
const recordRegalResolverPlan = vi.fn().mockResolvedValue(undefined)
const logRequest = vi.fn().mockResolvedValue(undefined)

vi.mock("../services/database", () => ({
  DatabaseService: class {
    recordRegalCallEvent = recordRegalCallEvent
    getRegalCallEvents = getRegalCallEvents
    recordRegalResolverPlan = recordRegalResolverPlan
    logRequest = logRequest
  },
}))

import { regalEventRoutes } from "./regal-events"

function app() {
  const a = new Hono<AppEnv>()
  a.route("/api/v1", regalEventRoutes)
  return a
}

const transcriptBody = {
  event_type: "transcript_available",
  regal_task_id: "task-1",
  transcript: "hello",
  recording_duration: 1500,
  customProperties: { LegalState: "No", collectionsBalance: 2 },
}

const completedBody = {
  event_type: "call_completed",
  regal_task_id: "task-1",
  disposition: "1.4 - Converted/Won > END CAMPAIGNS",
  recording_duration: 1800,
}

function post(path: string, body: unknown, auth = true) {
  return app().request(
    `/api/v1${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    createEnv(),
  )
}

describe("Regal event routes", () => {
  beforeEach(() => {
    recordRegalCallEvent.mockClear().mockResolvedValue(undefined)
    recordRegalResolverPlan.mockClear().mockResolvedValue(undefined)
    logRequest.mockClear()
    getRegalCallEvents.mockReset().mockResolvedValue({})
  })

  it("returns 401 without auth", async () => {
    expect((await post("/events/transcript-available", transcriptBody, false)).status).toBe(401)
    expect((await post("/events/call-completed", completedBody, false)).status).toBe(401)
    expect(recordRegalCallEvent).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid JSON", async () => {
    const res = await post("/events/transcript-available", "{not json", true)
    expect(res.status).toBe(400)
  })

  it("returns 400 on schema validation failure", async () => {
    const res = await post("/events/transcript-available", { event_type: "transcript_available" }, true)
    expect(res.status).toBe(400)
    expect(recordRegalCallEvent).not.toHaveBeenCalled()
  })

  it("records the event and returns 202 with a shadow plan summary", async () => {
    getRegalCallEvents.mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
    const res = await post("/events/transcript-available", transcriptBody, true)

    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(json.regal_task_id).toBe("task-1")
    expect(json.event_type).toBe("transcript_available")
    expect(json.status).toBe("recorded")
    // joined transcript+completed => enrolled with all gated modules
    expect(json.shadow_plan.enrolled).toBe(true)
    expect(json.shadow_plan.triggered).toContain("full_qa")
    expect(json.shadow_plan.triggered).toContain("litigation_check")

    expect(recordRegalCallEvent).toHaveBeenCalledOnce()
    expect(recordRegalResolverPlan).toHaveBeenCalledOnce()
  })

  it("records call-completed events too", async () => {
    getRegalCallEvents.mockResolvedValue({ completed: completedBody })
    const res = await post("/events/call-completed", completedBody, true)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(json.event_type).toBe("call_completed")
    expect(recordRegalCallEvent).toHaveBeenCalledOnce()
  })

  function postWithEnv(path: string, body: unknown, env: ReturnType<typeof createEnv>) {
    return app().request(
      `/api/v1${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify(body),
      },
      env,
    )
  }

  it("launches a workflow per triggered module when a transcript is joined", async () => {
    getRegalCallEvents.mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await postWithEnv("/events/transcript-available", transcriptBody, env)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any

    // Fully-enrolled plan => all five modules queued via deterministic instance ids.
    const modules = json.active_triggers.map((t: any) => t.module)
    expect(new Set(modules)).toEqual(new Set(json.shadow_plan.triggered))
    expect(json.active_triggers.every((t: any) => t.status === "queued")).toBe(true)
    expect(create).toHaveBeenCalledTimes(json.shadow_plan.triggered.length)
    for (const call of create.mock.calls) {
      expect(call[0].id).toBe(`task-1-${call[0].params.moduleName}`)
      expect(call[0].params.callData.call_id).toBe("task-1")
      expect(call[0].params.callData.transcript.metadata.disposition).toBe(completedBody.disposition)
      expect(call[0].params.callData.transcript.metadata.duration).toBe(transcriptBody.recording_duration)
    }
  })

  it("launches gated modules when completed arrives after a stored transcript", async () => {
    getRegalCallEvents.mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await postWithEnv("/events/call-completed", completedBody, env)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any

    expect(json.shadow_plan.enrolled).toBe(true)
    expect(json.active_triggers.map((t: any) => t.module)).toEqual(json.shadow_plan.triggered)
    expect(create).toHaveBeenCalledTimes(json.shadow_plan.triggered.length)
    expect(create.mock.calls.map((call: any[]) => call[0].id)).toContain("task-1-program_expectations")
    expect(create.mock.calls.map((call: any[]) => call[0].id)).toContain("task-1-warm_transfer")
    expect(create.mock.calls.map((call: any[]) => call[0].id)).toContain("task-1-litigation_check")
  })

  it("does NOT launch workflows for a call_completed-only plan (no transcript data)", async () => {
    getRegalCallEvents.mockResolvedValue({ completed: completedBody })
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await postWithEnv("/events/call-completed", completedBody, env)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(create).not.toHaveBeenCalled()
    expect(json.active_triggers).toBeUndefined()
    // Plan is still stored for the deferred launch when the transcript arrives.
    expect(recordRegalResolverPlan).toHaveBeenCalledOnce()
  })

  it("treats 'already exists' workflow errors as skipped and still returns 202", async () => {
    getRegalCallEvents.mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
    const env = createEnv()
    ;(env.EVALUATION_WORKFLOW.create as any).mockRejectedValue(
      new Error("instance with id already exists"),
    )

    const res = await postWithEnv("/events/transcript-available", transcriptBody, env)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(json.active_triggers.every((t: any) => t.status === "skipped")).toBe(true)
  })

  it("reports unexpected workflow errors but still records the event and returns 202", async () => {
    getRegalCallEvents.mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
    const env = createEnv()
    ;(env.EVALUATION_WORKFLOW.create as any).mockRejectedValue(new Error("kaboom"))

    const res = await postWithEnv("/events/transcript-available", transcriptBody, env)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(json.status).toBe("recorded")
    expect(json.active_triggers.every((t: any) => t.status === "error")).toBe(true)
    expect(recordRegalCallEvent).toHaveBeenCalledOnce()
  })

  it("still returns 202 when the shadow plan write fails (best-effort)", async () => {
    getRegalCallEvents.mockRejectedValue(new Error("read boom"))
    const res = await post("/events/transcript-available", transcriptBody, true)
    expect(res.status).toBe(202)
    const json = (await res.json()) as any
    expect(json.status).toBe("recorded")
    expect(json.shadow_plan).toBeUndefined()
  })
})
