import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../types/env"
import { DatabaseService } from "../services/database"
import { runRegalBackfillBatch } from "../services/regal-backfill"
import { auth } from "../middleware/auth"

/**
 * Admin backfill for the Regal missed-window incident (2026-07-01), when events
 * and resolver plans were recorded but EVALUATION_WORKFLOWs were never launched.
 *
 * POST /api/v1/admin/regal-events/backfill-missed re-launches only the triggered
 * modules that still have no eavesly_module_results, reusing the shared
 * runRegalBackfillBatch helper (same resolver plan + callData path as the live
 * events endpoints). Deduplicated within the configured Workflow retention
 * window via deterministic `${call_id}-${moduleName}` instance ids. Behind the
 * same INTERNAL_API_KEY auth as every other internal route. Responses are
 * name/id/count only — never transcript, contact, or payload data.
 */

const BackfillSchema = z.object({
  start: z.string().datetime().default("2026-07-01T20:08:00Z"),
  end: z.string().datetime().default("2026-07-01T20:49:51Z"),
  limit: z.number().int().min(1).max(100).default(25),
  dry_run: z.boolean().default(true),
  // Informational only — surfaced back in the response, does not change behavior.
  include_partial_transition: z.boolean().optional(),
  // Accepted but never acts: the three tables have upsert onConflict constraints,
  // so automated deletion is unsafe/unwarranted. See response note.
  cleanup_duplicates: z.boolean().optional(),
})

/**
 * Read-only aggregate integrity report for the post-Regal-Journeys cutover:
 * events -> resolver plans -> module results. Query params: start/end (ISO,
 * default last 24h) and grace_minutes (default 30) — plans newer than the
 * grace period aren't counted as missing results. Counts and regal_task_id
 * samples only; no transcripts, contacts, phones, payloads, or result_json.
 */
const IntegrityQuerySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  grace_minutes: z.coerce.number().int().min(0).max(1440).default(30),
})

const regalAdminRoutes = new Hono<AppEnv>()
regalAdminRoutes.use("*", auth)

regalAdminRoutes.get("/admin/regal-events/integrity", async (c) => {
  const parsed = IntegrityQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400)
  }

  const now = Date.now()
  const end = parsed.data.end ?? new Date(now).toISOString()
  const start = parsed.data.start ?? new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const grace_minutes = parsed.data.grace_minutes
  const graceCutoff = new Date(now - grace_minutes * 60 * 1000).toISOString()

  const db = new DatabaseService(c.env)
  const report = await db.getRegalIntegrityReport(start, end, graceCutoff)

  return c.json({
    window: { start, end, grace_minutes, grace_cutoff: graceCutoff },
    ...report,
  })
})

regalAdminRoutes.post("/admin/regal-events/backfill-missed", async (c) => {
  const correlationId = c.get("correlationId")

  let body: unknown = {}
  const raw = await c.req.text()
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return c.json({ error: "Invalid JSON" }, 400)
    }
  }

  const parsed = BackfillSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400)
  }
  const { start, end, limit, dry_run, include_partial_transition, cleanup_duplicates } = parsed.data

  const db = new DatabaseService(c.env)
  const result = await runRegalBackfillBatch({
    db,
    env: c.env,
    start,
    end,
    limit,
    dryRun: dry_run,
    correlationId,
  })

  const duplicate_note = cleanup_duplicates
    ? "No cleanup performed: eavesly_module_results, eavesly_regal_call_events, and eavesly_regal_resolver_plans all use upsert onConflict constraints, so duplicates are counts-only and no safe automated deletion is available."
    : undefined

  return c.json({
    ...result,
    ...(duplicate_note ? { duplicate_note } : {}),
    ...(include_partial_transition !== undefined ? { include_partial_transition } : {}),
  })
})

export { regalAdminRoutes }
