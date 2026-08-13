import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { auth } from "../middleware/auth"
import {
  AchieveQaRecoveryRequestSchema,
  type AchieveQaRecoveryCallId,
} from "../schemas/achieve-qa-recovery"
import {
  inspectAchieveQaRecovery,
  type AchieveQaRecoveryInspector,
} from "../services/achieve-qa-recovery"
import { createSupabaseAchieveQaRecoveryInspector } from "../services/achieve-qa-recovery-adapter"
import type { AppEnv, Bindings } from "../types/env"
import { log } from "../utils/logger"
import { workflowRetentionForEnvironment } from "../workflows/workflow-retention"

export type { AchieveQaRecoveryInspector }

type CreateAchieveQaRecoveryInspector = (env: Bindings) => AchieveQaRecoveryInspector

/** Compact deterministic Workflow identity; the payload still carries and rechecks the complete digest. */
export function achieveQaRecoveryWorkflowInstanceId(digest: string): string {
  return `achieve-qa-r4-${digest.slice(0, 48)}`
}

/** Build the authenticated, aggregate-only Achieve QA Gate 4 recovery route. */
export function createAchieveQaRecoveryAdminRoutes(
  createInspector: CreateAchieveQaRecoveryInspector = createSupabaseAchieveQaRecoveryInspector,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()
  routes.use("*", auth)

  routes.post(
    "/admin/achieve-welcome-call-qa/recover-gaps",
    bodyLimit({
      maxSize: 8_192,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const mediaType = c.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase()
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

      const parsed = AchieveQaRecoveryRequestSchema.safeParse(body)
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400)

      const snapshot = await inspectAchieveQaRecovery(
        createInspector(c.env),
        parsed.data.call_ids,
      )
      c.header("Cache-Control", "no-store")
      if ("_tag" in snapshot) {
        log("error", "Achieve QA recovery inspection failed", {
          correlationId: c.get("correlationId"),
          operation: "achieve_qa_recovery_inspect",
          errorTag: snapshot.reason,
          candidateCount: parsed.data.call_ids.length,
        })
        return c.json({ error: "Recovery unavailable", reason: snapshot.reason }, 503)
      }

      if (parsed.data.dry_run) {
        log("info", "Achieve QA recovery dry run completed", {
          correlationId: c.get("correlationId"),
          candidateCount: snapshot.summary.candidate_count,
          processableCount: snapshot.summary.processable_count,
          transcriptUnavailableCount: snapshot.summary.transcript_unavailable_count,
          existingResultCount: snapshot.summary.existing_result_count,
          digestFingerprint: snapshot.digest.value.slice(0, 12),
        })
        return c.json({
          status: "dry_run_complete",
          dry_run: true,
          ...snapshot.summary,
          digest: snapshot.digest,
        })
      }

      if (parsed.data.digest?.value !== snapshot.digest.value) {
        log("warn", "Achieve QA recovery execution rejected", {
          correlationId: c.get("correlationId"),
          operation: "achieve_qa_recovery_authorize",
          reason: "snapshot_digest_mismatch",
          candidateCount: snapshot.summary.candidate_count,
        })
        return c.json({
          status: "rejected",
          reason: "snapshot_digest_mismatch",
          ...snapshot.summary,
        }, 409)
      }
      if (c.env.ACHIEVE_QA_RECOVERY_APPROVED_DIGEST !== snapshot.digest.value) {
        log("warn", "Achieve QA recovery execution rejected", {
          correlationId: c.get("correlationId"),
          operation: "achieve_qa_recovery_authorize",
          reason: "server_approval_missing",
          candidateCount: snapshot.summary.candidate_count,
          digestFingerprint: snapshot.digest.value.slice(0, 12),
        })
        return c.json({
          status: "rejected",
          reason: "server_approval_missing",
          ...snapshot.summary,
        }, 409)
      }
      if (snapshot.summary.processable_count === 0) {
        return c.json({
          status: "rejected",
          reason: "no_processable_candidates",
          ...snapshot.summary,
        }, 409)
      }

      const callIds: ReadonlyArray<AchieveQaRecoveryCallId> = [...parsed.data.call_ids]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      const instanceId = achieveQaRecoveryWorkflowInstanceId(snapshot.digest.value)
      let status: "queued" | "already_queued" = "queued"
      try {
        await c.env.ACHIEVE_QA_RECOVERY_WORKFLOW.create({
          id: instanceId,
          params: {
            call_ids: callIds,
            digest: snapshot.digest,
          },
          retention: workflowRetentionForEnvironment(c.env.ENVIRONMENT),
        })
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.message.includes("already exists")) {
          status = "already_queued"
        } else {
          log("error", "Achieve QA recovery enqueue failed", {
            correlationId: c.get("correlationId"),
            operation: "achieve_qa_recovery_enqueue",
            errorTag: "enqueue_unavailable",
            candidateCount: snapshot.summary.candidate_count,
            processableCount: snapshot.summary.processable_count,
            digestFingerprint: snapshot.digest.value.slice(0, 12),
          })
          return c.json({ error: "Recovery unavailable", reason: "enqueue_unavailable" }, 503)
        }
      }

      log("info", "Achieve QA recovery execution accepted", {
        correlationId: c.get("correlationId"),
        status,
        candidateCount: snapshot.summary.candidate_count,
        processableCount: snapshot.summary.processable_count,
        transcriptUnavailableCount: snapshot.summary.transcript_unavailable_count,
        digestFingerprint: snapshot.digest.value.slice(0, 12),
      })
      return c.json({
        status,
        dry_run: false,
        ...snapshot.summary,
        digest: snapshot.digest,
      }, 202)
    },
  )

  return routes
}
