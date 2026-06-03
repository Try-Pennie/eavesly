import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
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
}

export function createEvalRoutes({ endpoint, moduleName }: EvalRouteConfig): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.use("*", auth)

  routes.post(`/evaluate/${endpoint}`, async (c) => {
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
    zValidator("json", BatchEvaluateRequestSchema),
    async (c) => {
      const { calls } = c.req.valid("json")
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
