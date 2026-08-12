import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv, Bindings } from "../types/env"
import { auth } from "../middleware/auth"
import { AchieveBackfillDryRunRequestSchema } from "../schemas/achieve-backfill-dry-run"
import { AchieveBackfillCanaryRequestSchema } from "../schemas/achieve-backfill-canary"
import { AchieveBackfillRemaining56RequestSchema } from "../schemas/achieve-backfill-remaining56"
import {
  AchieveBackfillResume27RequestSchema,
  type AchieveBackfillResume27Request,
} from "../schemas/achieve-backfill-resume27"
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
import {
  authorizeAchieveBackfillRemaining56,
  type AchieveBackfillRemaining56Authorization,
} from "../services/achieve-backfill-remaining56"
import type { AchieveBackfillRemaining56Request } from "../schemas/achieve-backfill-remaining56"
import { achieveBackfillRemaining56WorkflowInstanceId } from "../workflows/achieve-backfill-remaining56-workflow"
import {
  ACHIEVE_BACKFILL_RESUME27_PROGRESS_FINGERPRINT,
  authorizeAchieveBackfillResume27,
  type AchieveBackfillResume27Approval,
  type AchieveBackfillResume27Authorization,
} from "../services/achieve-backfill-resume27"
import { achieveBackfillResume27WorkflowInstanceId } from "../workflows/achieve-backfill-resume27-workflow"
import { workflowRetentionForEnvironment } from "../workflows/workflow-retention"
import { log } from "../utils/logger"

type CreateAchieveBackfillInspector = (env: Bindings) => AchieveBackfillInspector
type AuthorizeAchieveBackfillRemaining56 = (
  command: AchieveBackfillRemaining56Request,
  approval: AchieveBackfillCanaryApproval,
) => Promise<AchieveBackfillRemaining56Authorization>
type AuthorizeAchieveBackfillResume27 = (
  command: AchieveBackfillResume27Request,
  approval: AchieveBackfillResume27Approval,
) => Promise<AchieveBackfillResume27Authorization>

export { ACHIEVE_BACKFILL_APPROVED_DIGEST }

/** Build the authenticated, ID-only PSAI-245 Gate 1 and Gate 2 admin routes. */
export function createAchieveBackfillAdminRoutes(
  createInspector: CreateAchieveBackfillInspector = createSupabaseAchieveBackfillInspector,
  canaryApproval: AchieveBackfillCanaryApproval = {
    approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST,
  },
  authorizeRemaining56: AuthorizeAchieveBackfillRemaining56 = authorizeAchieveBackfillRemaining56,
  authorizeResume27: AuthorizeAchieveBackfillResume27 = authorizeAchieveBackfillResume27,
  resume27Approval: AchieveBackfillResume27Approval = {
    approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST,
    approvedProgressStateFingerprint: ACHIEVE_BACKFILL_RESUME27_PROGRESS_FINGERPRINT,
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

  routes.post(
    "/admin/achieve-welcome-call-qa/backfill/remaining-56",
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

      const request = AchieveBackfillRemaining56RequestSchema.safeParse(body)
      if (!request.success) return c.json({ error: "Invalid request" }, 400)

      const authorization = await authorizeRemaining56(
        request.data,
        canaryApproval,
      )
      c.header("Cache-Control", "no-store")
      if (authorization._tag !== "authorized") {
        const unavailable = authorization._tag === "unavailable"
        return c.json({
          ...(unavailable ? { error: "Remaining-56 unavailable" } : { status: "rejected" }),
          reason: authorization.reason,
          candidate_count: 57,
          remaining_count: 56,
          approved_digest: request.data.digest.value,
        }, unavailable ? 503 : 409)
      }

      const instanceId = achieveBackfillRemaining56WorkflowInstanceId(request.data.digest.value)
      let status: "queued" | "already_queued" = "queued"
      try {
        await c.env.ACHIEVE_BACKFILL_REMAINING56_WORKFLOW.create({
          id: instanceId,
          params: request.data,
          retention: workflowRetentionForEnvironment(c.env.ENVIRONMENT),
        })
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.message.includes("already exists")) {
          status = "already_queued"
        } else {
          log("error", "Achieve backfill remaining-56 enqueue failed", {
            correlationId: c.get("correlationId"),
            errorTag: "remaining56_enqueue_failed",
            candidateCount: 57,
            remainingCount: 56,
            approvedDigest: request.data.digest.value,
          })
          return c.json({
            error: "Remaining-56 unavailable",
            reason: "enqueue_unavailable",
            candidate_count: 57,
            remaining_count: 56,
            approved_digest: request.data.digest.value,
          }, 503)
        }
      }

      return c.json({
        status,
        candidate_count: 57,
        remaining_count: 56,
        approved_digest: request.data.digest.value,
      }, 202)
    },
  )

  routes.post(
    "/admin/achieve-welcome-call-qa/backfill/resume-27",
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

      const request = AchieveBackfillResume27RequestSchema.safeParse(body)
      if (!request.success) return c.json({ error: "Invalid request" }, 400)

      const authorization = await authorizeResume27(request.data, resume27Approval)
      c.header("Cache-Control", "no-store")
      if (authorization._tag !== "authorized") {
        const unavailable = authorization._tag === "unavailable"
        return c.json({
          ...(unavailable ? { error: "Resume-27 unavailable" } : { status: "rejected" }),
          reason: authorization.reason,
          candidate_count: 57,
          resume_count: 27,
          approved_digest: request.data.digest.value,
          progress_state_fingerprint: request.data.progress_state_fingerprint.value,
        }, unavailable ? 503 : 409)
      }

      const instanceId = achieveBackfillResume27WorkflowInstanceId(
        request.data.digest.value,
        request.data.progress_state_fingerprint.value,
      )
      let status: "queued" | "already_queued" = "queued"
      try {
        await c.env.ACHIEVE_BACKFILL_RESUME27_WORKFLOW.create({
          id: instanceId,
          params: request.data,
          retention: workflowRetentionForEnvironment(c.env.ENVIRONMENT),
        })
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.message.includes("already exists")) {
          status = "already_queued"
        } else {
          log("error", "Achieve backfill resume-27 enqueue failed", {
            correlationId: c.get("correlationId"),
            errorTag: "resume27_enqueue_failed",
            candidateCount: 57,
            resumeCount: 27,
            approvedDigest: request.data.digest.value,
            progressStateFingerprint: request.data.progress_state_fingerprint.value,
          })
          return c.json({
            error: "Resume-27 unavailable",
            reason: "enqueue_unavailable",
            candidate_count: 57,
            resume_count: 27,
            approved_digest: request.data.digest.value,
            progress_state_fingerprint: request.data.progress_state_fingerprint.value,
          }, 503)
        }
      }

      return c.json({
        status,
        candidate_count: 57,
        resume_count: 27,
        approved_digest: request.data.digest.value,
        progress_state_fingerprint: request.data.progress_state_fingerprint.value,
      }, 202)
    },
  )

  return routes
}
