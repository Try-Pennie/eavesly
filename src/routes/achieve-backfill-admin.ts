import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv, Bindings } from "../types/env"
import { auth } from "../middleware/auth"
import { AchieveBackfillDryRunRequestSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillCanaryRequestSchema } from "../schemas/achieve-backfill-canary"
import {
  runAchieveBackfillDryRun,
  type AchieveBackfillInspector,
} from "../services/achieve-backfill-dry-run"
import { createSupabaseAchieveBackfillInspector } from "../services/achieve-backfill-inspector"
import {
  ACHIEVE_BACKFILL_APPROVED_DIGEST,
  authorizeAchieveBackfillCanary,
  type AchieveBackfillCanaryApproval,
} from "../services/achieve-backfill-canary"
import {
  achieveBackfillCanaryWorkflowInstanceId,
} from "../workflows/achieve-backfill-canary-workflow"
import { workflowRetentionForEnvironment } from "../workflows/workflow-retention"
import { log } from "../utils/logger"

type CreateAchieveBackfillInspector = (env: Bindings) => AchieveBackfillInspector

export { ACHIEVE_BACKFILL_APPROVED_DIGEST }

/** Build the authenticated, ID-only PSAI-245 Gate 1 and Gate 2 admin routes. */
export function createAchieveBackfillAdminRoutes(
  createInspector: CreateAchieveBackfillInspector = createSupabaseAchieveBackfillInspector,
  canaryApproval: AchieveBackfillCanaryApproval = {
    approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST,
  },
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()
  routes.use("*", auth)

  routes.post(
    "/admin/achieve-welcome-call-qa/backfill/dry-run",
    bodyLimit({
      maxSize: 16_384,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const contentType = c.req.header("Content-Type")
      const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
      if (mediaType !== "application/json") {
        return c.json({ error: "Content-Type must be application/json" }, 415)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.name === "BodyLimitError") {
          return c.json({ error: "Request body too large" }, 413)
        }
        return c.json({ error: "Invalid request" }, 400)
      }

      const request = AchieveBackfillDryRunRequestSchema.safeParse(body)
      if (!request.success) {
        return c.json({ error: "Invalid request" }, 400)
      }

      let result
      try {
        result = await runAchieveBackfillDryRun(
          createInspector(c.env),
          request.data.call_ids,
        )
      } catch {
        log("error", "Achieve backfill Gate 1 dry run failed", {
          correlationId: c.get("correlationId"),
          errorTag: "unexpected_dry_run_failure",
          candidateCount: request.data.call_ids.length,
        })
        return c.json({ error: "Dry run unavailable", reason: "read_unavailable" }, 503)
      }

      c.header("Cache-Control", "no-store")
      if (result._tag === "unavailable") {
        return c.json({
          error: "Dry run unavailable",
          reason: result.reason,
        }, 503)
      }
      if (result._tag === "rejected") {
        return c.json({
          status: "rejected",
          reason: result.reason,
          call_ids: result.callIds,
        }, 409)
      }

      return c.json({
        status: "ready_for_gate_2_approval",
        manifest: result.manifest,
        digest: result.digest,
      })
    },
  )

  routes.post(
    "/admin/achieve-welcome-call-qa/backfill/canary",
    bodyLimit({
      maxSize: 16_384,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const contentType = c.req.header("Content-Type")
      const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
      if (mediaType !== "application/json") {
        return c.json({ error: "Content-Type must be application/json" }, 415)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.name === "BodyLimitError") {
          return c.json({ error: "Request body too large" }, 413)
        }
        return c.json({ error: "Invalid request" }, 400)
      }

      const request = AchieveBackfillCanaryRequestSchema.safeParse(body)
      if (!request.success) {
        return c.json({ error: "Invalid request" }, 400)
      }
      const canaryIndex = request.data.manifest.candidates.findIndex(
        (candidate) => candidate.call_id === request.data.canary_call_id,
      )
      const canaryOrdinal = canaryIndex < 0 ? null : canaryIndex + 1

      const authorization = await authorizeAchieveBackfillCanary(
        request.data,
        canaryApproval,
      )
      c.header("Cache-Control", "no-store")
      if (authorization !== undefined) {
        if (authorization._tag === "unavailable") {
          return c.json({
            error: "Canary unavailable",
            reason: authorization.reason,
            canary_ordinal: canaryOrdinal,
            candidate_count: request.data.manifest.candidate_count,
            approved_digest: request.data.digest.value,
          }, 503)
        }
        return c.json({
          status: "rejected",
          reason: authorization.reason,
          canary_ordinal: canaryOrdinal,
          candidate_count: request.data.manifest.candidate_count,
          approved_digest: request.data.digest.value,
        }, 409)
      }

      const instanceId = achieveBackfillCanaryWorkflowInstanceId(request.data.digest.value)
      let status: "queued" | "already_queued" = "queued"
      try {
        await c.env.ACHIEVE_BACKFILL_CANARY_WORKFLOW.create({
          id: instanceId,
          params: request.data,
          retention: workflowRetentionForEnvironment(c.env.ENVIRONMENT),
        })
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.message.includes("already exists")) {
          status = "already_queued"
        } else {
          log("error", "Achieve backfill Gate 2 canary enqueue failed", {
            correlationId: c.get("correlationId"),
            errorTag: "canary_enqueue_failed",
            canaryOrdinal,
            candidateCount: request.data.manifest.candidate_count,
            approvedDigest: request.data.digest.value,
          })
          return c.json({
            error: "Canary unavailable",
            reason: "enqueue_unavailable",
            canary_ordinal: canaryOrdinal,
            candidate_count: request.data.manifest.candidate_count,
            approved_digest: request.data.digest.value,
          }, 503)
        }
      }

      return c.json({
        status,
        canary_ordinal: canaryOrdinal,
        candidate_count: request.data.manifest.candidate_count,
        approved_digest: request.data.digest.value,
      }, 202)
    },
  )

  return routes
}
