import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import type { AppEnv, Bindings } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  AchieveQaTranscriptRecoverySourceEventSchema,
} from "../schemas/achieve-qa-transcript-recovery"
import type { AchieveQaTranscriptRecoveryLedger } from "../services/achieve-qa-transcript-recovery"
import { createAchieveQaTranscriptRecoveryAdminRoutes } from "./achieve-qa-transcript-recovery-admin"

const AUTH_KEY = "test-achieve-transcript-recovery-key-32chars"
const events = Array.from(
  { length: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT },
  (_, index) => AchieveQaTranscriptRecoverySourceEventSchema.parse({
    event_type: "transcript_available",
    regal_task_id: `achieve-gap-${String(index + 1).padStart(2, "0")}`,
    transcript: `private transcript ${index + 1}`,
    transcript_is_truncated: false,
  }),
)

class RecordingLedger implements AchieveQaTranscriptRecoveryLedger {
  inspections = 0
  restores = 0
  state: "absent" | "identical" = "absent"

  async inspect() {
    this.inspections += 1
    return { _tag: "success" as const, state: this.state }
  }

  async restore() {
    this.restores += 1
    return this.state === "identical"
      ? { _tag: "already_restored" as const }
      : { _tag: "restored" as const }
  }
}

function createApp(createLedger: (env: Bindings) => AchieveQaTranscriptRecoveryLedger) {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", createAchieveQaTranscriptRecoveryAdminRoutes(createLedger))
  return app
}

function request(
  app: Hono<AppEnv>,
  body: unknown,
  env: Bindings = createEnv({ ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: AUTH_KEY }),
  credential: string | null = AUTH_KEY,
) {
  return app.request(
    "/api/v1/admin/achieve-welcome-call-qa/recover-transcript-events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credential === null ? {} : { Authorization: `Bearer ${credential}` }),
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("Achieve QA exact-12 transcript recovery admin route", () => {
  it("returns an aggregate-only digest for the exact private dry run", async () => {
    const ledger = new RecordingLedger()
    const app = createApp(() => ledger)

    const response = await request(app, { events: [...events].reverse() })
    const text = await response.text()
    const body = JSON.parse(text) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toMatchObject({
      status: "dry_run_complete",
      dry_run: true,
      candidate_count: 12,
      ready_insert_count: 12,
      already_restored_count: 0,
      digest: {
        algorithm: "SHA-256",
        canonicalization: "achieve-qa-transcript-recovery-v1",
        value: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(text).not.toContain(events[0].regal_task_id)
    expect(text).not.toContain(events[0].transcript)
    expect(ledger.inspections).toBe(1)
    expect(ledger.restores).toBe(0)
  })

  it("restores only when submitted and server-owned digests match", async () => {
    const ledger = new RecordingLedger()
    const app = createApp(() => ledger)
    const dryRun = await request(app, { events })
    const dryBody = await dryRun.json() as { digest: { value: string } }
    const env = createEnv({
      ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: AUTH_KEY,
      ACHIEVE_QA_TRANSCRIPT_RECOVERY_APPROVED_DIGEST: dryBody.digest.value,
    })

    const response = await request(app, {
      events,
      dry_run: false,
      digest: {
        algorithm: "SHA-256",
        canonicalization: "achieve-qa-transcript-recovery-v1",
        value: dryBody.digest.value,
      },
    }, env)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "restored",
      dry_run: false,
      candidate_count: 12,
      restored_count: 12,
      already_restored_count: 0,
    })
    expect(ledger.restores).toBe(1)
  })

  it("rejects execution when the separate server digest approval is absent", async () => {
    const ledger = new RecordingLedger()
    const app = createApp(() => ledger)
    const dryRun = await request(app, { events })
    const dryBody = await dryRun.json() as { digest: unknown }

    const response = await request(app, { events, dry_run: false, digest: dryBody.digest })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      status: "rejected",
      reason: "server_approval_missing",
      candidate_count: 12,
    })
    expect(ledger.restores).toBe(0)
  })

  it("fails closed on partial persisted state without restoring", async () => {
    const ledger: AchieveQaTranscriptRecoveryLedger = {
      async inspect() { return { _tag: "failure", reason: "partial_state" } },
      async restore() { throw new Error("must not restore") },
    }
    const response = await request(createApp(() => ledger), { events })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      status: "rejected",
      reason: "partial_state",
      candidate_count: 12,
    })
  })

  it.each([
    ["missing", null, createEnv({ ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: AUTH_KEY }), 401],
    ["the general internal key", TEST_API_KEY, createEnv({ ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: AUTH_KEY }), 401],
    ["wrong", "wrong-credential-that-is-at-least-32-characters", createEnv({ ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: AUTH_KEY }), 401],
    ["unconfigured", AUTH_KEY, createEnv({ ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY: undefined }), 503],
  ] as const)("authenticates before body parsing and DB construction when credential is %s", async (_case, credential, env, status) => {
    let constructions = 0
    const app = createApp(() => {
      constructions += 1
      return new RecordingLedger()
    })

    const response = await request(app, { malformed: "private" }, env, credential)

    expect(response.status).toBe(status)
    expect(constructions).toBe(0)
  })

  it("accepts the evidenced multi-megabyte body but rejects bodies over the route-local limit", async () => {
    const ledger = new RecordingLedger()
    const app = createApp(() => ledger)
    const largeEvents = events.map((event) => ({
      ...event,
      transcript: "x".repeat(210_000),
    }))

    const accepted = await request(app, { events: largeEvents })
    const rejected = await request(app, { events, padding: "x".repeat(4_200_000) })

    expect(accepted.status).toBe(200)
    expect(rejected.status).toBe(413)
  })
})
