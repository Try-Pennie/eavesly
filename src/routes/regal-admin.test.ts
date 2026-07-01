import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

const getBackfillCandidates = vi.fn()
const getDuplicateAudit = vi.fn()
const getRegalCallEvents = vi.fn()

vi.mock("../services/database", () => ({
  DatabaseService: class {
    getBackfillCandidates = getBackfillCandidates
    getDuplicateAudit = getDuplicateAudit
    getRegalCallEvents = getRegalCallEvents
  },
}))

import { regalAdminRoutes } from "./regal-admin"

function app() {
  const a = new Hono<AppEnv>()
  a.route("/api/v1", regalAdminRoutes)
  return a
}

// Fully-enrolled joined events => plan triggers all five modules.
const transcriptBody = {
  event_type: "transcript_available",
  regal_task_id: "task-1",
  transcript: "hello secret transcript",
  recording_duration: 1500,
  contact_name: "Jane Secret",
  contact_phone: "+15559998888",
  customProperties: { LegalState: "No", collectionsBalance: 2 },
}
const completedBody = {
  event_type: "call_completed",
  regal_task_id: "task-1",
  disposition: "1.4 - Converted/Won > END CAMPAIGNS",
  recording_duration: 1800,
}

function post(body: unknown, env = createEnv(), auth = true) {
  return app().request(
    "/api/v1/admin/regal-events/backfill-missed",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  )
}

describe("Regal admin backfill route", () => {
  beforeEach(() => {
    getBackfillCandidates.mockReset().mockResolvedValue([])
    getDuplicateAudit.mockReset().mockResolvedValue({
      duplicate_module_results: 0,
      duplicate_call_events: 0,
      duplicate_resolver_plans: 0,
    })
    getRegalCallEvents.mockReset().mockResolvedValue({ transcript: transcriptBody, completed: completedBody })
  })

  it("returns 401 without auth", async () => {
    const res = await post({ dry_run: true }, createEnv(), false)
    expect(res.status).toBe(401)
    expect(getBackfillCandidates).not.toHaveBeenCalled()
  })

  it("dry-run returns candidate counts and does not launch any workflow", async () => {
    getBackfillCandidates.mockResolvedValue([
      { regal_task_id: "task-1", triggered_modules: ["full_qa", "litigation_check"], missing_modules: ["full_qa", "litigation_check"] },
      { regal_task_id: "task-2", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
    ])
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await post({ dry_run: true }, env)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any

    expect(json.dry_run).toBe(true)
    expect(json.candidates).toBe(2)
    expect(json.missing_module_counts).toEqual({ full_qa: 2, litigation_check: 1 })
    expect(json.sample[0]).toEqual({ regal_task_id: "task-1", missing_modules: ["full_qa", "litigation_check"] })
    expect(create).not.toHaveBeenCalled()
    expect(getRegalCallEvents).not.toHaveBeenCalled()
  })

  it("live mode launches only missing modules and reports existing results as skipped", async () => {
    // Plan triggers 5 modules; only 2 are missing => launch 2, skip 3 existing.
    getBackfillCandidates.mockResolvedValue([
      {
        regal_task_id: "task-1",
        triggered_modules: ["full_qa", "disposition_review", "program_expectations", "warm_transfer", "litigation_check"],
        missing_modules: ["full_qa", "litigation_check"],
      },
    ])
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await post({ dry_run: false }, env)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any

    expect(json.dry_run).toBe(false)
    expect(json.processed_tasks).toBe(1)
    expect(json.launched).toBe(2)
    expect(json.skipped_existing_result).toBe(3)
    expect(json.skipped_existing_workflow).toBe(0)
    expect(json.errors).toBe(0)

    expect(create).toHaveBeenCalledTimes(2)
    const launchedModules = create.mock.calls.map((call: any[]) => call[0].params.moduleName)
    expect(new Set(launchedModules)).toEqual(new Set(["full_qa", "litigation_check"]))
    for (const call of create.mock.calls) {
      expect(call[0].id).toBe(`task-1-${call[0].params.moduleName}`)
    }
  })

  it("counts 'already exists' workflow errors as skipped_existing_workflow", async () => {
    getBackfillCandidates.mockResolvedValue([
      { regal_task_id: "task-1", triggered_modules: ["full_qa", "litigation_check"], missing_modules: ["full_qa", "litigation_check"] },
    ])
    const env = createEnv()
    ;(env.EVALUATION_WORKFLOW.create as any).mockRejectedValue(new Error("instance with id already exists"))

    const res = await post({ dry_run: false }, env)
    const json = (await res.json()) as any
    expect(json.launched).toBe(0)
    expect(json.skipped_existing_workflow).toBe(2)
    expect(json.errors).toBe(0)
  })

  it("respects limit and reports remaining_estimate", async () => {
    getBackfillCandidates.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        regal_task_id: `task-${i}`,
        triggered_modules: ["full_qa"],
        missing_modules: ["full_qa"],
      })),
    )
    const env = createEnv()
    const res = await post({ dry_run: false, limit: 2 }, env)
    const json = (await res.json()) as any
    expect(json.processed_tasks).toBe(2)
    expect(json.remaining_estimate).toBe(3)
  })

  it("never leaks transcript/contact/payload data in the response", async () => {
    getBackfillCandidates.mockResolvedValue([
      { regal_task_id: "task-1", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
    ])
    const dry = await (await post({ dry_run: true })).text()
    const live = await (await post({ dry_run: false })).text()
    for (const raw of [dry, live]) {
      expect(raw).not.toContain("hello secret transcript")
      expect(raw).not.toContain("Jane Secret")
      expect(raw).not.toContain("+15559998888")
      expect(raw).not.toContain("payload")
      expect(raw).not.toContain("contact_phone")
    }
  })

  it("returns duplicate audit counts without performing cleanup", async () => {
    getBackfillCandidates.mockResolvedValue([
      { regal_task_id: "task-1", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
    ])
    getDuplicateAudit.mockResolvedValue({
      duplicate_module_results: 2,
      duplicate_call_events: 0,
      duplicate_resolver_plans: 1,
    })
    const res = await post({ dry_run: true, cleanup_duplicates: true })
    const json = (await res.json()) as any
    expect(json.duplicate_audit).toEqual({
      duplicate_module_results: 2,
      duplicate_call_events: 0,
      duplicate_resolver_plans: 1,
    })
    expect(json.duplicate_note).toMatch(/No cleanup performed/)
  })
})
