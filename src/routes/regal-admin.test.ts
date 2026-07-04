import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

const getBackfillCandidates = vi.fn()
const getDuplicateAudit = vi.fn()
const getRegalCallEvents = vi.fn()
const getResolverPolicy = vi.fn()
const getRegalIntegrityReport = vi.fn()

vi.mock("../services/database", () => ({
  DatabaseService: class {
    getBackfillCandidates = getBackfillCandidates
    getDuplicateAudit = getDuplicateAudit
    getRegalCallEvents = getRegalCallEvents
    getResolverPolicy = getResolverPolicy
    getRegalIntegrityReport = getRegalIntegrityReport
  },
}))

const DEFAULT_ACTIVE_POLICY = {
  policy: {
    enrollmentDisposition: "1.4 - Converted/Won > END CAMPAIGNS",
    enrollmentMinDurationSeconds: 1200,
    excludedCampaignFriendlyIds: [],
    warmTransferLegalStateValue: "No",
    collectionsMinBalance: 1,
  },
  policyVersion: null,
}

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
    getResolverPolicy.mockReset().mockResolvedValue(DEFAULT_ACTIVE_POLICY)
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

  it("does not get stuck on a missing-transcript candidate before a valid one", async () => {
    getBackfillCandidates.mockResolvedValue([
      { regal_task_id: "task-1", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
      { regal_task_id: "task-2", triggered_modules: ["full_qa"], missing_modules: ["full_qa"] },
    ])
    // task-1 unexpectedly has no stored transcript; task-2 does.
    getRegalCallEvents.mockImplementation((id: string) =>
      id === "task-1"
        ? Promise.resolve({})
        : Promise.resolve({ transcript: { ...transcriptBody, regal_task_id: "task-2" }, completed: completedBody }),
    )
    const env = createEnv()
    const create = env.EVALUATION_WORKFLOW.create as any

    const res = await post({ dry_run: false, limit: 1 }, env)
    const json = (await res.json()) as any

    expect(json.skipped_unprocessable).toBe(1)
    expect(json.processed_tasks).toBe(1)
    expect(json.launched).toBe(1)
    // The valid task-2 drained despite unprocessable task-1 being first.
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].id).toBe("task-2-full_qa")
    expect(json.sample).toEqual([{ regal_task_id: "task-2", missing_modules: ["full_qa"] }])
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

  describe("integrity report route", () => {
    const EMPTY_REPORT = {
      events: { transcript_available: 0, call_completed: 0, tasks_with_both: 0, transcript_only: 0, completed_only: 0 },
      plans: { total: 0, with_triggered_modules: 0, policy_version_null: 0, event_tasks_missing_plan: 0 },
      module_results: {
        plans_checked: 0,
        plans_within_grace: 0,
        plans_missing_results: 0,
        missing_module_counts: {},
        sample_missing: [],
      },
      warm_transfer: { triggered: 0, with_result: 0, with_partner_followup_result: 0 },
    }

    function get(query = "", auth = true) {
      return app().request(
        `/api/v1/admin/regal-events/integrity${query}`,
        { headers: auth ? { Authorization: `Bearer ${TEST_API_KEY}` } : {} },
        createEnv(),
      )
    }

    beforeEach(() => {
      getRegalIntegrityReport.mockReset().mockResolvedValue(EMPTY_REPORT)
    })

    it("returns 401 without auth", async () => {
      const res = await get("", false)
      expect(res.status).toBe(401)
      expect(getRegalIntegrityReport).not.toHaveBeenCalled()
    })

    it("defaults to a 24h window with a 30-minute grace period", async () => {
      const res = await get()
      expect(res.status).toBe(200)
      const json = (await res.json()) as any

      const [start, end, graceCutoff] = getRegalIntegrityReport.mock.calls[0]
      expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 60 * 60 * 1000)
      expect(new Date(end).getTime() - new Date(graceCutoff).getTime()).toBe(30 * 60 * 1000)
      expect(json.window).toEqual({ start, end, grace_minutes: 30, grace_cutoff: graceCutoff })
      expect(json.events).toEqual(EMPTY_REPORT.events)
      expect(json.plans).toEqual(EMPTY_REPORT.plans)
      expect(json.module_results).toEqual(EMPTY_REPORT.module_results)
      expect(json.warm_transfer).toEqual(EMPTY_REPORT.warm_transfer)
    })

    it("honors explicit start/end/grace_minutes", async () => {
      const res = await get("?start=2026-07-01T00:00:00Z&end=2026-07-02T00:00:00Z&grace_minutes=120")
      expect(res.status).toBe(200)
      const json = (await res.json()) as any

      expect(getRegalIntegrityReport).toHaveBeenCalledWith(
        "2026-07-01T00:00:00Z",
        "2026-07-02T00:00:00Z",
        expect.any(String),
      )
      expect(json.window.grace_minutes).toBe(120)
    })

    it("rejects invalid query params", async () => {
      expect((await get("?start=yesterday")).status).toBe(400)
      expect((await get("?grace_minutes=-5")).status).toBe(400)
      expect(getRegalIntegrityReport).not.toHaveBeenCalled()
    })

    it("is read-only: never launches workflows or touches backfill helpers", async () => {
      const env = createEnv()
      await app().request(
        "/api/v1/admin/regal-events/integrity",
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
        env,
      )
      expect((env.EVALUATION_WORKFLOW.create as any)).not.toHaveBeenCalled()
      expect(getBackfillCandidates).not.toHaveBeenCalled()
      expect(getRegalCallEvents).not.toHaveBeenCalled()
    })
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
