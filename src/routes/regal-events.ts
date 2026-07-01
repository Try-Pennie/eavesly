import { Hono } from "hono"
import type { z } from "zod"
import type { AppEnv } from "../types/env"
import {
  TranscriptAvailableEventSchema,
  CallCompletedEventSchema,
} from "../schemas/regal-events"
import { DatabaseService } from "../services/database"
import { buildModuleTriggerPlan, DEFAULT_RESOLVER_POLICY, type RegalCallEvent } from "../services/regal-events"
import { auth } from "../middleware/auth"
import { log } from "../utils/logger"

/**
 * Canonical Regal journey webhook endpoints (shadow mode).
 *
 * These record the event into the durable ledger and compute a shadow resolver
 * plan for later comparison. They deliberately do NOT trigger EVALUATION_WORKFLOW
 * — the existing Regal journey still owns real evaluation until shadow validation
 * is complete.
 */
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

    // Build + store a shadow resolver plan from whatever events we have joined so
    // far. Best-effort: a plan failure must not fail the ledger write.
    let planSummary: { enrolled: boolean; triggered: string[] } | undefined
    try {
      const joined = await db.getRegalCallEvents(event.regal_task_id)
      const plan = buildModuleTriggerPlan(joined, DEFAULT_RESOLVER_POLICY)
      await db.recordRegalResolverPlan(plan)
      planSummary = { enrolled: plan.enrolled, triggered: plan.triggered }
    } catch (e) {
      log("warn", "Shadow resolver plan failed", {
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

    return c.json(
      {
        regal_task_id: event.regal_task_id,
        event_type: event.event_type,
        status: "recorded",
        ...(planSummary ? { shadow_plan: planSummary } : {}),
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
