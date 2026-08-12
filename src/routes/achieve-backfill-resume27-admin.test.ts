import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import type { AppEnv } from "../types/env"
import { createAchieveBackfillAdminRoutes } from "./achieve-backfill-admin"

const digest = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const fingerprint = "ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4"
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
    progress_state_fingerprint: {
      algorithm: "SHA-256",
      canonicalization: "psai-245-resume-progress-state-v1",
      value: fingerprint,
    },
  }
}

function app() {
  const instance = new Hono<AppEnv>()
  instance.route("/api/v1", createAchieveBackfillAdminRoutes(
    () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
    { approvedDigest: digest },
    undefined,
    async (command, approval) => (
      command.digest.value === approval.approvedDigest
      && command.progress_state_fingerprint.value === fingerprint
        ? { _tag: "authorized", pendingCallIds: callIds.slice(30) }
        : { _tag: "rejected", reason: "progress_state_fingerprint_mismatch" }
    ),
    { approvedDigest: digest, approvedProgressStateFingerprint: fingerprint },
  ))
  return instance
}

function request(command: unknown, env = createEnv()) {
  return app().request("/api/v1/admin/achieve-welcome-call-qa/backfill/resume-27", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  }, env)
}

describe("PSAI-245 resume-27 admin route", () => {
  it("queues only the distinct deterministic resume Workflow with categorical output", async () => {
    const env = createEnv({ ENVIRONMENT: "production" })

    const response = await request(body(), env)
    const text = await response.text()

    expect(response.status).toBe(202)
    expect(JSON.parse(text)).toEqual({
      status: "queued",
      candidate_count: 57,
      resume_count: 27,
      approved_digest: digest,
      progress_state_fingerprint: fingerprint,
    })
    expect(text).not.toContain(callIds[29])
    expect(env.ACHIEVE_BACKFILL_RESUME27_WORKFLOW.create).toHaveBeenCalledWith({
      id: "psai245-r27-298d6e8202117910-ce2f6acc1fe56eea",
      params: body(),
      retention: { successRetention: "7 days", errorRetention: "14 days" },
    })
    expect(env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create).not.toHaveBeenCalled()
    expect(env.EVALUATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("rejects a fingerprint mismatch and private/skip/regrade fields before enqueue", async () => {
    const env = createEnv()
    const drifted = body()
    drifted.progress_state_fingerprint.value = "f".repeat(64)

    expect((await request(drifted, env)).status).toBe(409)
    expect((await request({ ...body(), skip_ordinal: 30 }, env)).status).toBe(400)
    expect((await request({ ...body(), regrade_call_id: callIds[29] }, env)).status).toBe(400)
    expect(env.ACHIEVE_BACKFILL_RESUME27_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("returns already_queued for the one deterministic instance", async () => {
    const env = createEnv()
    vi.mocked(env.ACHIEVE_BACKFILL_RESUME27_WORKFLOW.create)
      .mockRejectedValue(new Error("workflow instance already exists"))

    const response = await request(body(), env)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ status: "already_queued" })
  })
})
