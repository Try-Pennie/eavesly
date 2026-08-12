import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import type { AppEnv } from "../types/env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { createAchieveBackfillAdminRoutes } from "./achieve-backfill-admin"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const callIds = Array.from({ length: 57 }, (_, index) => AchieveBackfillCallIdSchema.parse(
  `approved-call-${String(index + 1).padStart(2, "0")}`,
))
function body() {
  return {
    manifest: {
      representation_version: "psai-245-achieve-backfill-manifest-v1",
      gate: "gate_1_dry_run",
      module_name: "achieve_welcome_call_qa",
      snapshot: { cutoff: "2026-08-11T16:21:44.777859Z", funnel_counts: [378, 101, 89, 88, 65, 57] },
      candidate_count: 57,
      candidates: callIds.map((call_id) => ({ call_id, reason: "approved_frozen_cohort", status: "eligible" })),
    },
    digest: { algorithm: "SHA-256", canonicalization: "eavesly-canonical-json-v1", value: digest },
    completed_canary: {
      call_id: callIds[0],
      audit_only: true,
      approved_digest: digest,
      batch_id: "psai-245-gate-2-approved-manifest",
      canary_id: "psai-245-gate-2-one-call-canary",
      manifest_version: "psai-245-achieve-backfill-manifest-v1",
      snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
    },
  }
}

function app(
  authorizeRemaining56?: Parameters<typeof createAchieveBackfillAdminRoutes>[2],
) {
  const instance = new Hono<AppEnv>()
  instance.route("/api/v1", createAchieveBackfillAdminRoutes(
    () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
    { approvedDigest: digest },
    authorizeRemaining56,
  ))
  return instance
}

function request(command: unknown, env = createEnv(), instance = app()) {
  return instance.request("/api/v1/admin/achieve-welcome-call-qa/backfill/remaining-56", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  }, env)
}

describe("PSAI-245 remaining-56 admin route", () => {
  it("queues only the separately bound deterministic Workflow with categorical output", async () => {
    const env = createEnv({ ENVIRONMENT: "production" })
    const create = vi.mocked(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create)

    const response = await request(body(), env)
    const text = await response.text()

    expect(response.status).toBe(202)
    expect(JSON.parse(text)).toEqual({
      status: "queued",
      candidate_count: 57,
      remaining_count: 56,
      approved_digest: digest,
    })
    expect(text).not.toContain(callIds[0])
    expect(create).toHaveBeenCalledWith({
      id: `psai-245-gate-3-remaining-56-once-${digest}`,
      params: body(),
      retention: { successRetention: "7 days", errorRetention: "14 days" },
    })
    expect(env.ACHIEVE_BACKFILL_CANARY_WORKFLOW.create).not.toHaveBeenCalled()
    expect(env.EVALUATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("returns already_queued for the deterministic existing Workflow", async () => {
    const env = createEnv()
    vi.mocked(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create)
      .mockRejectedValue(new Error("workflow instance already exists"))

    const response = await request(body(), env)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ status: "already_queued" })
  })

  it("returns categorical 503 when enqueue is unavailable", async () => {
    const env = createEnv()
    vi.mocked(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create)
      .mockRejectedValue(new Error("binding unavailable"))

    const response = await request(body(), env)
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(text)).toEqual({
      error: "Remaining-56 unavailable",
      reason: "enqueue_unavailable",
      candidate_count: 57,
      remaining_count: 56,
      approved_digest: digest,
    })
    expect(text).not.toContain(callIds[0])
  })

  it("returns categorical 503 when authorization is unavailable", async () => {
    const env = createEnv()
    const unavailableApp = app(async () => ({ _tag: "unavailable", reason: "invalid_response" }))

    const response = await request(body(), env, unavailableApp)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "Remaining-56 unavailable",
      reason: "invalid_response",
      candidate_count: 57,
      remaining_count: 56,
      approved_digest: digest,
    })
    expect(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("rejects mismatched canary provenance and private fields before enqueue", async () => {
    const env = createEnv()
    const wrong = body()
    wrong.completed_canary.approved_digest = "f".repeat(64)
    expect((await request(wrong, env)).status).toBe(409)
    expect((await request({ ...body(), transcript: "private" }, env)).status).toBe(400)
    expect(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create).not.toHaveBeenCalled()
  })
})
