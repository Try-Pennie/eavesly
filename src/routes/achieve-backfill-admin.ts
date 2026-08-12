import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv, Bindings } from "../types/env"
import { auth } from "../middleware/auth"
import { AchieveBackfillDryRunRequestSchema } from "../schemas/achieve-backfill-dry-run"
import {
  runAchieveBackfillDryRun,
  type AchieveBackfillInspector,
} from "../services/achieve-backfill-dry-run"
import { createSupabaseAchieveBackfillInspector } from "../services/achieve-backfill-inspector"
import { log } from "../utils/logger"

type CreateAchieveBackfillInspector = (env: Bindings) => AchieveBackfillInspector

/** Build the authenticated, ID-only PSAI-245 Gate 1 dry-run route. */
export function createAchieveBackfillAdminRoutes(
  createInspector: CreateAchieveBackfillInspector = createSupabaseAchieveBackfillInspector,
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

  return routes
}
