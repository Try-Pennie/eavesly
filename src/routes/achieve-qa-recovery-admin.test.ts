import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import type { AppEnv, Bindings } from "../types/env"
import type { AchieveQaRecoverySource } from "../services/achieve-qa-recovery"
import { DEFAULT_RESOLVER_POLICY } from "../services/regal-events"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import {
  createAchieveQaRecoveryAdminRoutes,
  type AchieveQaRecoveryInspector,
} from "./achieve-qa-recovery-admin"

const callIds = Array.from({ length: 17 }, (_, index) => `achieve-gap-${index + 1}`)

const GRADEABLE_TRANSCRIPT = [
  "[handling agent]: A client success advocate will take your welcome call in a moment.",
  "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
  "[transfer agent]: Hi. This is Julissa with Freedom Debt Relief on a recorded line.",
  "[contact]: Hi.",
  "[transfer agent]: Welcome to your program. Your deposits go into your dedicated account.",
  "[transfer agent]: We negotiate with each creditor and you authorize settlements.",
  "[transfer agent]: Let's set up your client dashboard now.",
  "[transfer agent]: Congratulations again and have a great evening!",
].join("\n")

function processableSource(callId: string): AchieveQaRecoverySource {
  return {
    sourceKind: "legacy_qa",
    transcript: GRADEABLE_TRANSCRIPT,
    metadata: {
      duration: 301,
      timestamp: "2026-08-12T00:00:00Z",
      disposition: DEFAULT_RESOLVER_POLICY.enrollmentDisposition,
    },
    sfdcLeadId: `lead-${callId}`,
  }
}

class RecordingWorkflow {
  readonly creations: Array<unknown> = []

  async create(input: unknown): Promise<{ id: string }> {
    this.creations.push(input)
    return { id: "unused" }
  }

  async createBatch(): Promise<never> {
    throw new Error("not implemented")
  }

  async get(): Promise<never> {
    throw new Error("not implemented")
  }
}

function createApp(inspector: AchieveQaRecoveryInspector): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.route(
    "/api/v1",
    createAchieveQaRecoveryAdminRoutes(() => inspector),
  )
  return app
}

async function recoveryRequest(
  app: Hono<AppEnv>,
  body: unknown,
  env: Bindings = createEnv(),
  authorized = true,
): Promise<Response> {
  return await app.request(
    "/api/v1/admin/achieve-welcome-call-qa/recover-gaps",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("Achieve QA Gate 4 recovery admin route", () => {
  const inspector: AchieveQaRecoveryInspector = {
    async inspect(requestedCallIds) {
      return {
        _tag: "success",
        policy: DEFAULT_RESOLVER_POLICY,
        candidates: requestedCallIds.map((callId, index) =>
          index < 5
            ? {
                callId,
                existingResult: false,
                source: processableSource(callId),
              }
            : {
                callId,
                existingResult: false,
                source: null,
                inputStatus: "transcript_unavailable" as const,
              },
        ),
      }
    },
  }

  it("dry-runs the exact 17 ID artifact and reports five processable versus twelve transcript-unavailable without enqueueing", async () => {
    const workflow = new RecordingWorkflow()
    const env = createEnv({
      ACHIEVE_QA_RECOVERY_WORKFLOW: workflow as unknown as Workflow,
    })

    const response = await recoveryRequest(
      createApp(inspector),
      { call_ids: [...callIds].reverse() },
      env,
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toMatchObject({
      status: "dry_run_complete",
      dry_run: true,
      candidate_count: 17,
      processable_count: 5,
      transcript_unavailable_count: 12,
      invalid_input_count: 0,
      unknown_call_count: 0,
      ineligible_count: 0,
      existing_result_count: 0,
    })
    expect(body).not.toHaveProperty("call_ids")
    expect(JSON.stringify(body)).not.toContain(callIds[0])
    expect(body.digest).toMatchObject({
      algorithm: "SHA-256",
      canonicalization: "achieve-qa-gap-recovery-v2",
      value: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(workflow.creations).toEqual([])
  })

  it("rejects execution unless the recomputed digest is separately allowlisted server-side", async () => {
    const app = createApp(inspector)
    const dryRun = await recoveryRequest(app, { call_ids: callIds })
    const dryBody = await dryRun.json() as { digest: unknown }

    const response = await recoveryRequest(app, {
      call_ids: callIds,
      dry_run: false,
      digest: dryBody.digest,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      status: "rejected",
      reason: "server_approval_missing",
      candidate_count: 17,
      processable_count: 5,
      transcript_unavailable_count: 12,
    })
  })

  it("queues only the exact digest-bound private artifact on the dedicated Workflow", async () => {
    const app = createApp(inspector)
    const dryRun = await recoveryRequest(app, { call_ids: [...callIds].reverse() })
    const dryBody = await dryRun.json() as {
      digest: { algorithm: "SHA-256"; canonicalization: "achieve-qa-gap-recovery-v2"; value: string }
    }
    const workflow = new RecordingWorkflow()
    const env = createEnv({
      ACHIEVE_QA_RECOVERY_APPROVED_DIGEST: dryBody.digest.value,
      ACHIEVE_QA_RECOVERY_WORKFLOW: workflow as unknown as Workflow,
    })

    const response = await recoveryRequest(app, {
      call_ids: [...callIds].reverse(),
      dry_run: false,
      digest: dryBody.digest,
    }, env)
    const responseText = await response.text()

    expect(response.status).toBe(202)
    expect(JSON.parse(responseText)).toMatchObject({
      status: "queued",
      dry_run: false,
      candidate_count: 17,
      processable_count: 5,
      transcript_unavailable_count: 12,
    })
    expect(responseText).not.toContain(callIds[0])
    expect(workflow.creations).toHaveLength(1)
    expect(workflow.creations[0]).toEqual({
      id: `achieve-qa-r4-${dryBody.digest.value.slice(0, 48)}`,
      params: {
        call_ids: [...callIds].sort(),
        digest: dryBody.digest,
      },
      retention: {
        successRetention: "1 day",
        errorRetention: "3 days",
      },
    })
  })

  it.each([
    ["too few IDs", { call_ids: callIds.slice(0, 16) }],
    ["too many IDs", { call_ids: [...callIds, "achieve-gap-18"] }],
    ["duplicate IDs", { call_ids: [...callIds.slice(0, 16), callIds[0]] }],
    ["unknown field", { call_ids: callIds, transcript: "private" }],
  ])("rejects %s before inspection", async (_name, body) => {
    let inspections = 0
    const response = await recoveryRequest(createApp({
      async inspect() {
        inspections += 1
        return { _tag: "failure", reason: "read_unavailable" }
      },
    }), body)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid request" })
    expect(inspections).toBe(0)
  })

  it("requires INTERNAL_API_KEY before inspecting private IDs", async () => {
    let inspections = 0
    const response = await recoveryRequest(createApp({
      async inspect() {
        inspections += 1
        return { _tag: "failure", reason: "read_unavailable" }
      },
    }), { call_ids: callIds }, createEnv(), false)

    expect(response.status).toBe(401)
    expect(inspections).toBe(0)
  })
})
