import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { achieveQaTranscriptRecoveryAuth } from "../middleware/achieve-qa-transcript-recovery-auth"
import {
  ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
  AchieveQaTranscriptRecoveryRequestSchema,
} from "../schemas/achieve-qa-transcript-recovery"
import {
  inspectAchieveQaTranscriptRecovery,
  type AchieveQaTranscriptRecoveryLedger,
} from "../services/achieve-qa-transcript-recovery"
import { createSupabaseAchieveQaTranscriptRecoveryLedger } from "../services/achieve-qa-transcript-recovery-adapter"
import type { AppEnv, Bindings } from "../types/env"
import { log } from "../utils/logger"

const ACHIEVE_QA_TRANSCRIPT_RECOVERY_BODY_MAX_BYTES = 4_194_304

type CreateAchieveQaTranscriptRecoveryLedger = (
  env: Bindings,
) => AchieveQaTranscriptRecoveryLedger

function isStateConflict(reason: string): boolean {
  return reason === "partial_state"
    || reason === "conflict_state"
    || reason === "malformed_state"
    || reason === "invalid_response"
}

/** Build the least-privilege, aggregate-only exact-12 transcript-ledger recovery route. */
export function createAchieveQaTranscriptRecoveryAdminRoutes(
  createLedger: CreateAchieveQaTranscriptRecoveryLedger = createSupabaseAchieveQaTranscriptRecoveryLedger,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.post(
    "/admin/achieve-welcome-call-qa/recover-transcript-events",
    achieveQaTranscriptRecoveryAuth,
    bodyLimit({
      maxSize: ACHIEVE_QA_TRANSCRIPT_RECOVERY_BODY_MAX_BYTES,
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

      const command = AchieveQaTranscriptRecoveryRequestSchema.safeParse(body)
      if (!command.success) return c.json({ error: "Invalid request" }, 400)

      let ledger: AchieveQaTranscriptRecoveryLedger
      try {
        ledger = createLedger(c.env)
      } catch {
        return c.json({ error: "Recovery unavailable", reason: "read_unavailable" }, 503)
      }

      let snapshot
      try {
        snapshot = await inspectAchieveQaTranscriptRecovery(ledger, command.data.events)
      } catch {
        return c.json({ error: "Recovery unavailable", reason: "read_unavailable" }, 503)
      }
      if ("_tag" in snapshot) {
        log(isStateConflict(snapshot.reason) ? "warn" : "error", "Achieve transcript recovery inspection failed", {
          correlationId: c.get("correlationId"),
          operation: "achieve_qa_transcript_recovery_inspect",
          errorTag: snapshot.reason,
          candidateCount: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
        })
        if (isStateConflict(snapshot.reason)) {
          return c.json({
            status: "rejected",
            reason: snapshot.reason,
            candidate_count: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
          }, 409)
        }
        return c.json({ error: "Recovery unavailable", reason: snapshot.reason }, 503)
      }

      if (command.data.dry_run) {
        log("info", "Achieve transcript recovery dry run completed", {
          correlationId: c.get("correlationId"),
          candidateCount: snapshot.summary.candidate_count,
          readyInsertCount: snapshot.summary.ready_insert_count,
          alreadyRestoredCount: snapshot.summary.already_restored_count,
          digestFingerprint: snapshot.digest.value.slice(0, 12),
        })
        return c.json({
          status: "dry_run_complete",
          dry_run: true,
          ...snapshot.summary,
          digest: snapshot.digest,
        })
      }

      if (command.data.digest?.value !== snapshot.digest.value) {
        return c.json({
          status: "rejected",
          reason: "snapshot_digest_mismatch",
          ...snapshot.summary,
        }, 409)
      }
      if (c.env.ACHIEVE_QA_TRANSCRIPT_RECOVERY_APPROVED_DIGEST !== snapshot.digest.value) {
        return c.json({
          status: "rejected",
          reason: "server_approval_missing",
          ...snapshot.summary,
        }, 409)
      }

      let restored
      try {
        restored = await ledger.restore(command.data.events)
      } catch {
        return c.json({ error: "Recovery unavailable", reason: "write_unavailable" }, 503)
      }
      if (restored._tag === "failure") {
        if (isStateConflict(restored.reason)) {
          return c.json({
            status: "rejected",
            reason: restored.reason,
            candidate_count: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
          }, 409)
        }
        return c.json({ error: "Recovery unavailable", reason: restored.reason }, 503)
      }

      const alreadyRestored = restored._tag === "already_restored"
      log("info", "Achieve transcript recovery execution completed", {
        correlationId: c.get("correlationId"),
        status: restored._tag,
        candidateCount: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
        digestFingerprint: snapshot.digest.value.slice(0, 12),
      })
      return c.json({
        status: restored._tag,
        dry_run: false,
        candidate_count: ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
        restored_count: alreadyRestored ? 0 : ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT,
        already_restored_count: alreadyRestored ? ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT : 0,
        digest: snapshot.digest,
      })
    },
  )

  return routes
}
