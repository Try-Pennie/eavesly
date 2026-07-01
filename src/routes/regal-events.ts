import { Hono } from "hono"
import type { z } from "zod"
import type { AppEnv } from "../types/env"
import {
  TranscriptAvailableEventSchema,
  CallCompletedEventSchema,
} from "../schemas/regal-events"
import { DatabaseService } from "../services/database"
import {
  buildModuleTriggerPlan,
  transcriptEventToCallData,
  DEFAULT_RESOLVER_POLICY,
  type RegalCallEvent,
} from "../services/regal-events"
import { launchModule, runRegalBackfillBatch, type ActiveTrigger } from "../services/regal-backfill"
import { auth } from "../middleware/auth"
import { log } from "../utils/logger"

/**
 * Canonical Regal journey webhook endpoints.
 *
 * These record the event into the durable ledger, compute + store a resolver
 * plan, and actively launch EVALUATION_WORKFLOW for every triggered module once a
 * transcript is available. Workflow instance ids are deterministic
 * (`${call_id}-${moduleName}`) so Cloudflare Workflows dedupes concurrent starts.
 * `shadow_plan` is retained in the response for continued shadow comparison.
 */

export { launchModule, type ActiveTrigger }

/**
 * Fixed missed-window incident (2026-07-01). Opportunistically drained from
 * normal authenticated Regal event traffic since the admin route needs a
 * production INTERNAL_API_KEY that isn't always available. Small best-effort
 * batch — never fails the event endpoint.
 */
const MISSED_WINDOW = { start: "2026-07-01T20:08:00Z", end: "2026-07-01T20:49:51Z", limit: 5 }

function createRegalEventRoute(
  routes: Hono<AppEnv>,
  path: string,
  endpoint: string,
  schema: z.ZodTypeAny,
) {
  routes.post(path, async (c) => {
    const db = new DatabaseService(c.env)
    const correlationId = c.get("correlationId")

    let rawBody: string
    try {
      rawBody = await c.req.text()
    } catch (e) {
      await db.logRequest({
        endpoint,
        status: "body_read_error",
        statusCode: 400,
        errorMessage: e instanceof Error ? e.message : String(e),
        correlationId,
      })
      return c.json({ error: "Failed to read request body" }, 400)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch (e) {
      await db.logRequest({
        endpoint,
        status: "json_parse_error",
        statusCode: 400,
        errorMessage: e instanceof Error ? e.message : String(e),
        rawBody,
        correlationId,
      })
      return c.json({ error: "Invalid JSON" }, 400)
    }

    const validation = schema.safeParse(parsed)
    if (!validation.success) {
      await db.logRequest({
        endpoint,
        status: "validation_error",
        statusCode: 400,
        errorMessage: validation.error.message,
        errorDetails: validation.error.issues,
        rawBody,
        correlationId,
      })
      return c.json({ error: "Validation failed", details: validation.error.issues }, 400)
    }

    const event = validation.data as RegalCallEvent

    // Primary write: store the event in the durable ledger (idempotent).
    await db.recordRegalCallEvent(event)

    // Build + store the resolver plan from whatever events we have joined so far,
    // then actively launch a workflow per triggered module. Best-effort: a plan or
    // launch failure must not fail the ledger write.
    let planSummary: { enrolled: boolean; triggered: string[] } | undefined
    let activeTriggers: ActiveTrigger[] | undefined
    try {
      const joined = await db.getRegalCallEvents(event.regal_task_id)
      const plan = buildModuleTriggerPlan(joined, DEFAULT_RESOLVER_POLICY)
      await db.recordRegalResolverPlan(plan)
      planSummary = { enrolled: plan.enrolled, triggered: plan.triggered }

      // Only launch once a transcript exists — callData is derived from it. A
      // call_completed-only plan is stored but deferred until the transcript
      // arrives, at which point all triggered modules launch from the joined plan.
      if (joined.transcript) {
        const callData = transcriptEventToCallData(joined.transcript, joined.completed)
        activeTriggers = await Promise.all(
          plan.triggered.map((moduleName) =>
            launchModule(c.env, moduleName, callData, correlationId),
          ),
        )
      }
    } catch (e) {
      log("warn", "Resolver plan / active trigger failed", {
        correlationId,
        regalTaskId: event.regal_task_id,
        error: e instanceof Error ? e.message : String(e),
      })
    }

    await db.logRequest({
      endpoint,
      callId: event.regal_task_id,
      status: "recorded",
      correlationId,
    })

    // Opportunistically drain a small slice of the fixed missed-window backlog
    // from this authenticated request. Best-effort: any failure is logged and
    // never fails the event endpoint. Returns fast once the backlog is empty.
    try {
      await runRegalBackfillBatch({
        db,
        env: c.env,
        start: MISSED_WINDOW.start,
        end: MISSED_WINDOW.end,
        limit: MISSED_WINDOW.limit,
        dryRun: false,
        correlationId,
      })
    } catch (e) {
      log("warn", "Opportunistic Regal backfill failed", {
        correlationId,
        error: e instanceof Error ? e.message : String(e),
      })
    }

    return c.json(
      {
        regal_task_id: event.regal_task_id,
        event_type: event.event_type,
        status: "recorded",
        ...(planSummary ? { shadow_plan: planSummary } : {}),
        ...(activeTriggers ? { active_triggers: activeTriggers } : {}),
      },
      202,
    )
  })
}

const regalEventRoutes = new Hono<AppEnv>()
regalEventRoutes.use("*", auth)

createRegalEventRoute(
  regalEventRoutes,
  "/events/transcript-available",
  "events/transcript-available",
  TranscriptAvailableEventSchema,
)
createRegalEventRoute(
  regalEventRoutes,
  "/events/call-completed",
  "events/call-completed",
  CallCompletedEventSchema,
)

export { regalEventRoutes }
