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

  it("does NOT trigger EVALUATION_WORKFLOW", async () => {
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any
    await app().request(
      "/api/v1/events/transcript-available",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify(transcriptBody),
      },
      env,
    )
    expect(create).not.toHaveBeenCalled()
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
