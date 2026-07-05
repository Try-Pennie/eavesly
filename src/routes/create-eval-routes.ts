import { Hono } from "hono"
import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
  EvaluateFromRecordingRequestSchema,
} from "../schemas/requests"
import type { EvaluateRequest } from "../schemas/requests"
import { DatabaseService } from "../services/database"
import { auth } from "../middleware/auth"

interface EvalRouteConfig {
  endpoint: string
  moduleName: string
  // When set, requests with a partner_id field that doesn't match are rejected 400.
  // partner_id is not a DB column; it lives in result_json — this validates the
  // incoming payload for partner-scoped endpoints (e.g. achieve-welcome-call-qa).
  requiredPartnerId?: string
}

export function createEvalRoutes({ endpoint, moduleName, requiredPartnerId }: EvalRouteConfig): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.use("*", auth)

  // Reads the raw body, parses JSON, and enforces the partner_id gate.
  // Returns the parsed payload, or a 400 Response (already logged) to return as-is.
  async function parseAndLog(
    c: Context<AppEnv>,
    db: DatabaseService,
    correlationId: string | undefined,
  ): Promise<{ rawBody: string; parsed: unknown } | Response> {
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

    if (requiredPartnerId) {
      const incomingPartnerId = (parsed as any)?.partner_id
      if (incomingPartnerId !== undefined && incomingPartnerId !== requiredPartnerId) {
        await db.logRequest({
          endpoint,
          callId: (parsed as any)?.call_id,
          status: "partner_id_mismatch",
          statusCode: 400,
          errorMessage: `partner_id must be '${requiredPartnerId}'`,
          correlationId,
        })
        return c.json({ error: `partner_id must be '${requiredPartnerId}'` }, 400)
      }
    }

    return { rawBody, parsed }
  }

  routes.post(`/evaluate/${endpoint}`, async (c) => {
    const db = new DatabaseService(c.env)
    const correlationId = c.get("correlationId")

    const parseResult = await parseAndLog(c, db, correlationId)
    if (parseResult instanceof Response) return parseResult
    const { rawBody, parsed } = parseResult

    const validation = EvaluateRequestSchema.safeParse(parsed)
    if (!validation.success) {
      await db.logRequest({
        endpoint,
        callId: (parsed as any)?.call_id,
        status: "validation_error",
        statusCode: 400,
        errorMessage: validation.error.message,
        errorDetails: validation.error.issues,
        rawBody,
        correlationId,
      })
      return c.json(
        { error: "Validation failed", details: validation.error.issues },
        400,
      )
    }

    const callData = validation.data

    await db.logRequest({
      endpoint,
      callId: callData.call_id,
      status: "received",
      correlationId,
    })

    const instanceId = `${callData.call_id}-${moduleName}`

    try {
      const instance = await c.env.EVALUATION_WORKFLOW.create({
        id: instanceId,
        params: { moduleName, callData, correlationId },
      })

      return c.json({
        call_id: callData.call_id,
        module: moduleName,
        correlation_id: correlationId,
        workflow_instance_id: instance.id,
        status: "queued",
        timestamp: new Date().toISOString(),
      }, 202)
    } catch (e) {
      if (e instanceof Error && e.message.includes("already exists")) {
        return c.json({
          call_id: callData.call_id,
          module: moduleName,
          workflow_instance_id: instanceId,
          status: "already_exists",
          message: "Evaluation already submitted for this call_id",
        }, 409)
      }
      throw e
    }
  })

  routes.post(
    `/evaluate/${endpoint}/batch`,
    async (c) => {
      // Mirrors the previous zValidator("json", ...): only parse when the
      // Content-Type is JSON (otherwise the empty body fails schema validation),
      // 400 "Malformed JSON" on parse failure, and return the raw safeParse
      // result on schema failure so the 400 body shape is unchanged.
      let body: unknown = {}
      const contentType = c.req.header("Content-Type")
      if (contentType && /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/.test(contentType)) {
        try {
          body = await c.req.json()
        } catch {
          throw new HTTPException(400, { message: "Malformed JSON in request body" })
        }
      }
      const validation = BatchEvaluateRequestSchema.safeParse(body)
      if (!validation.success) {
        return c.json(validation, 400)
      }
      const { calls } = validation.data
      const correlationId = c.get("correlationId") ?? crypto.randomUUID()
      const instances = await Promise.all(
        calls.map(callData =>
          c.env.EVALUATION_WORKFLOW.create({
            id: `${callData.call_id}-${moduleName}`,
            params: { moduleName, callData, correlationId },
          })
        )
      )
      return c.json({
        correlation_id: correlationId,
        total: calls.length,
        instances: instances.map(inst => ({ id: inst.id })),
        status: "queued",
        timestamp: new Date().toISOString(),
      }, 202)
    },
  )

  routes.post(`/evaluate/${endpoint}/from-recording`, async (c) => {
    const db = new DatabaseService(c.env)
    const correlationId = c.get("correlationId")

    const parseResult = await parseAndLog(c, db, correlationId)
    if (parseResult instanceof Response) return parseResult
    const { rawBody, parsed } = parseResult

    const validation = EvaluateFromRecordingRequestSchema.safeParse(parsed)
    if (!validation.success) {
      await db.logRequest({
        endpoint,
        callId: (parsed as any)?.call_id,
        status: "validation_error",
        statusCode: 400,
        errorMessage: validation.error.message,
        errorDetails: validation.error.issues,
        rawBody,
        correlationId,
      })
      return c.json({ error: "Validation failed", details: validation.error.issues }, 400)
    }

    const data = validation.data
    const callData: EvaluateRequest = {
      call_id: data.call_id,
      regal_task_id: data.regal_task_id,
      agent_id: data.agent_id,
      transcript: {
        transcript: "",
        metadata: {
          duration: data.metadata.duration ?? 0,
          timestamp: data.metadata.timestamp,
          talk_time: data.metadata.talk_time,
          disposition: data.metadata.disposition,
          campaign_name: data.metadata.campaign_name,
        },
      },
      agent_email: data.agent_email,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      recording_link: data.recording_url,
      call_summary: data.call_summary,
      transcript_url: data.transcript_url,
      sfdc_lead_id: data.sfdc_lead_id,
    }

    await db.logRequest({
      endpoint,
      callId: data.call_id,
      status: "received_recording",
      correlationId,
    })

    const instanceId = `${data.call_id}-${moduleName}`

    try {
      const instance = await c.env.EVALUATION_WORKFLOW.create({
        id: instanceId,
        params: {
          moduleName,
          callData,
          correlationId,
          recording: { url: data.recording_url, source: data.recording_source },
        },
      })

      return c.json({
        call_id: data.call_id,
        module: moduleName,
        correlation_id: correlationId,
        workflow_instance_id: instance.id,
        status: "queued",
        timestamp: new Date().toISOString(),
      }, 202)
    } catch (e) {
      if (e instanceof Error && e.message.includes("already exists")) {
        return c.json({
          call_id: data.call_id,
          module: moduleName,
          workflow_instance_id: instanceId,
          status: "already_exists",
          message: "Evaluation already submitted for this call_id",
        }, 409)
      }
      throw e
    }
  })

  return routes
}
