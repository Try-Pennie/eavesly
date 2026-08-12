import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import {
  ACHIEVE_BACKFILL_APPROVED_DIGEST,
  createAchieveBackfillAdminRoutes,
} from "./achieve-backfill-admin"

const CUTOFF = "2026-08-11T16:21:44.777859Z" as const
const callIds = Array.from(
  { length: 57 },
  (_, index) => AchieveBackfillCallIdSchema.parse(
    `approved-call-${String(index + 1).padStart(2, "0")}`,
  ),
)

function validRequest(ids: ReadonlyArray<string> = callIds) {
  return { snapshot_cutoff: CUTOFF, call_ids: ids }
}

function createApp(
  inspect: Parameters<typeof createAchieveBackfillAdminRoutes>[0] = () => ({
    inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }),
  }),
) {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", createAchieveBackfillAdminRoutes(inspect))
  return app
}

function request(
  app: Hono<AppEnv>,
  body: unknown,
  env = createEnv(),
  authorized = true,
) {
  return app.request(
    "/api/v1/admin/achieve-welcome-call-qa/backfill/dry-run",
    {
      method: "POST",
      headers: {
        ...(authorized ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}),
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  )
}

function canaryBody() {
  return {
    manifest: {
      representation_version: "psai-245-achieve-backfill-manifest-v1",
      gate: "gate_1_dry_run",
      module_name: "achieve_welcome_call_qa",
      snapshot: { cutoff: CUTOFF, funnel_counts: [378, 101, 89, 88, 65, 57] },
      candidate_count: 57,
      candidates: callIds.map((call_id) => ({
        call_id,
        reason: "approved_frozen_cohort",
        status: "eligible",
      })),
    },
    digest: {
      algorithm: "SHA-256",
      canonicalization: "eavesly-canonical-json-v1",
      value: "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8",
    },
    canary_call_id: callIds[0],
  }
}

function canaryRequest(
  app: Hono<AppEnv>,
  body: unknown,
  authorized = true,
  env = createEnv(),
) {
  return app.request(
    "/api/v1/admin/achieve-welcome-call-qa/backfill/canary",
    {
      method: "POST",
      headers: {
        ...(authorized ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("Achieve backfill Gate 1 admin route", () => {
  it("returns an ID-only manifest for the privately supplied frozen cohort", async () => {
    const app = createApp(() => ({
      inspect: async (requestedCallIds) => ({
        _tag: "success",
        knownCallIds: requestedCallIds,
        ordinaryResultCallIds: [],
      }),
    }))

    const response = await request(app, validRequest([...callIds].reverse()))

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      status: "ready_for_gate_2_approval",
      manifest: {
        representation_version: "psai-245-achieve-backfill-manifest-v1",
        gate: "gate_1_dry_run",
        module_name: "achieve_welcome_call_qa",
        snapshot: {
          cutoff: CUTOFF,
          funnel_counts: [378, 101, 89, 88, 65, 57],
        },
        candidate_count: 57,
        candidates: callIds.map((call_id) => ({
          call_id,
          reason: "approved_frozen_cohort",
          status: "eligible",
        })),
      },
      digest: {
        algorithm: "SHA-256",
        canonicalization: "eavesly-canonical-json-v1",
        value: "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8",
      },
    })
  })

  it("produces the same ordering and digest for every input ordering", async () => {
    const app = createApp(() => ({
      inspect: async (requestedCallIds) => ({
        _tag: "success",
        knownCallIds: [...requestedCallIds].reverse(),
        ordinaryResultCallIds: [],
      }),
    }))

    const ascending = await request(app, validRequest(callIds))
    const descending = await request(app, validRequest([...callIds].reverse()))

    expect(ascending.status).toBe(200)
    expect(await descending.json()).toEqual(await ascending.json())
  })

  it("aborts the entire dry run when any ordinary Achieve result exists", async () => {
    const conflicts = [callIds[9], callIds[2]]
    const app = createApp(() => ({
      inspect: async (requestedCallIds) => ({
        _tag: "success",
        knownCallIds: requestedCallIds,
        ordinaryResultCallIds: conflicts,
      }),
    }))

    const response = await request(app, validRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      status: "rejected",
      reason: "ordinary_results_exist",
      call_ids: [callIds[2], callIds[9]],
    })
  })

  it("fails closed when a supplied call ID is unknown", async () => {
    const app = createApp(() => ({
      inspect: async (requestedCallIds) => ({
        _tag: "success",
        knownCallIds: requestedCallIds.slice(1),
        ordinaryResultCallIds: [],
      }),
    }))

    const response = await request(app, validRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      status: "rejected",
      reason: "unknown_call_ids",
      call_ids: [callIds[0]],
    })
  })

  it("rejects duplicate IDs before performing a read", async () => {
    const inspect = vi.fn()
    const duplicateCohort = [...callIds.slice(0, 56), callIds[0]]
    const response = await request(
      createApp(() => ({ inspect })),
      validRequest(duplicateCohort),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      status: "rejected",
      reason: "duplicate_call_ids",
      call_ids: [callIds[0]],
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it.each([
    ["wrong cutoff", { snapshot_cutoff: "2026-08-11T16:21:44Z", call_ids: callIds }],
    ["wrong cohort size", validRequest(callIds.slice(0, 56))],
    ["malformed call ID", validRequest([...callIds.slice(0, 56), "not an id"])],
    ["unknown request field", { ...validRequest(), transcript: "forbidden-value" }],
  ])("rejects %s as malformed or unknown input", async (_name, body) => {
    const inspect = vi.fn()
    const response = await request(createApp(() => ({ inspect })), body)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid request" })
    expect(inspect).not.toHaveBeenCalled()
  })

  it("fails closed when ID-only reads are unavailable", async () => {
    const app = createApp(() => ({
      inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }),
    }))

    const response = await request(app, validRequest())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "Dry run unavailable",
      reason: "read_unavailable",
    })
  })

  it("does not expose a write or workflow seam during a successful public request", async () => {
    const reads: Array<ReadonlyArray<string>> = []
    const env = createEnv()
    const app = createApp(() => ({
      inspect: async (requestedCallIds) => {
        reads.push(requestedCallIds)
        return {
          _tag: "success",
          knownCallIds: requestedCallIds,
          ordinaryResultCallIds: [],
        }
      },
    }))

    const response = await request(app, validRequest([...callIds].reverse()), env)

    expect(response.status).toBe(200)
    expect(reads).toEqual([callIds])
    expect(env.EVALUATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("keeps request and response projections ID-only", async () => {
    const privateContent = "forbidden-value"
    const inspect = vi.fn()
    const response = await request(createApp(() => ({ inspect })), {
      ...validRequest(),
      summary: privateContent,
    })
    const responseText = await response.text()

    expect(response.status).toBe(400)
    expect(responseText).not.toContain(privateContent)
    expect(responseText).toBe(JSON.stringify({ error: "Invalid request" }))
    expect(inspect).not.toHaveBeenCalled()
  })

  it("requires internal authorization before reading IDs", async () => {
    const inspect = vi.fn()
    const response = await request(
      createApp(() => ({ inspect })),
      validRequest(),
      createEnv(),
      false,
    )

    expect(response.status).toBe(401)
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe("Achieve backfill Gate 2 canary admin route", () => {
  it("pins Noah's exact approved Gate 1 digest", () => {
    expect(ACHIEVE_BACKFILL_APPROVED_DIGEST).toBe(
      "01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e",
    )
  })

  it("validates and queues one deterministic dedicated Workflow without exposing IDs", async () => {
    const create = vi.fn().mockResolvedValue({ id: "categorical-instance" })
    const env = createEnv({
      ENVIRONMENT: "production",
      ACHIEVE_BACKFILL_CANARY_WORKFLOW: { create, get: vi.fn() } as any,
    })
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createAchieveBackfillAdminRoutes(
      () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
      { approvedDigest: canaryBody().digest.value },
    ))

    const response = await canaryRequest(app, canaryBody(), true, env)
    const responseText = await response.text()

    expect(response.status).toBe(202)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(JSON.parse(responseText)).toEqual({
      status: "queued",
      canary_ordinal: 1,
      candidate_count: 57,
      approved_digest: canaryBody().digest.value,
    })
    expect(responseText).not.toContain(callIds[0])
    expect(create).toHaveBeenCalledOnce()
    const creation = create.mock.calls[0][0]
    expect(creation.id).toBe(
      `psai-245-gate-2-one-call-canary-${canaryBody().digest.value}`,
    )
    expect(creation.params).toEqual(canaryBody())
    expect(creation.retention).toEqual({
      successRetention: "7 days",
      errorRetention: "14 days",
    })
    expect(env.EVALUATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it("maps concurrent/retried deterministic instance creation to already_queued", async () => {
    const createdInstances = new Set<string>()
    const create = vi.fn(async (input: { readonly id: string }) => {
      if (createdInstances.has(input.id)) {
        throw new Error("workflow instance already exists")
      }
      createdInstances.add(input.id)
      return { id: input.id }
    })
    const env = createEnv({
      ACHIEVE_BACKFILL_CANARY_WORKFLOW: { create, get: vi.fn() } as any,
    })
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createAchieveBackfillAdminRoutes(
      () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
      { approvedDigest: canaryBody().digest.value },
    ))

    const [first, retry] = await Promise.all([
      canaryRequest(app, canaryBody(), true, env),
      canaryRequest(app, canaryBody(), true, env),
    ])

    expect(first.status).toBe(202)
    expect(retry.status).toBe(202)
    expect(await first.json()).toMatchObject({ status: "queued" })
    expect(await retry.json()).toMatchObject({ status: "already_queued" })
    expect(create).toHaveBeenCalledTimes(2)
    expect(createdInstances.size).toBe(1)
    expect(new Set(create.mock.calls.map(([input]) => input.id))).toEqual(new Set([
      `psai-245-gate-2-one-call-canary-${canaryBody().digest.value}`,
    ]))
  })

  it("uses the same Workflow identity for different selected manifest members", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "categorical-instance" })
      .mockRejectedValueOnce(new Error("already exists"))
    const env = createEnv({
      ACHIEVE_BACKFILL_CANARY_WORKFLOW: { create, get: vi.fn() } as any,
    })
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createAchieveBackfillAdminRoutes(
      () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
      { approvedDigest: canaryBody().digest.value },
    ))
    const otherMember = { ...canaryBody(), canary_call_id: callIds[1] }

    await canaryRequest(app, canaryBody(), true, env)
    const second = await canaryRequest(app, otherMember, true, env)

    expect(await second.json()).toMatchObject({ status: "already_queued" })
    expect(create.mock.calls[0][0].id).toBe(create.mock.calls[1][0].id)
  })

  it("projects rejected commands without call IDs or enqueuing", async () => {
    const create = vi.fn()
    const env = createEnv({
      ACHIEVE_BACKFILL_CANARY_WORKFLOW: { create, get: vi.fn() } as any,
    })
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createAchieveBackfillAdminRoutes(
      () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
      { approvedDigest: canaryBody().digest.value },
    ))
    const outsideId = "outside-approved-cohort"
    const response = await canaryRequest(app, {
      ...canaryBody(),
      canary_call_id: outsideId,
    }, true, env)
    const text = await response.text()

    expect(response.status).toBe(409)
    expect(JSON.parse(text)).toEqual({
      status: "rejected",
      reason: "canary_not_in_manifest",
      canary_ordinal: null,
      candidate_count: 57,
      approved_digest: canaryBody().digest.value,
    })
    expect(text).not.toContain(outsideId)
    expect(text).not.toContain(callIds[0])
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects private fields and requires auth before enqueueing", async () => {
    const create = vi.fn()
    const env = createEnv({
      ACHIEVE_BACKFILL_CANARY_WORKFLOW: { create, get: vi.fn() } as any,
    })
    const app = new Hono<AppEnv>()
    app.route("/api/v1", createAchieveBackfillAdminRoutes(
      () => ({ inspect: async () => ({ _tag: "failure", reason: "read_unavailable" }) }),
      { approvedDigest: canaryBody().digest.value },
    ))
    const privateValue = "forbidden transcript and phone content"

    const malformed = await canaryRequest(
      app,
      { ...canaryBody(), transcript: privateValue },
      true,
      env,
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).toBe(JSON.stringify({ error: "Invalid request" }))

    const unauthorized = await canaryRequest(app, canaryBody(), false, env)
    expect(unauthorized.status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })
})
