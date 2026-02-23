import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
} from "../schemas/requests"
import { DatabaseService } from "../services/database"
import { MODULE_NAMES } from "../modules/constants"
import { auth } from "../middleware/auth"

const budgetInputsRoutes = new Hono<AppEnv>()

budgetInputsRoutes.use("*", auth)

budgetInputsRoutes.post("/evaluate/budget-inputs", async (c) => {
  const db = new DatabaseService(c.env)
  const correlationId = c.get("correlationId")

  // 1. Try to read raw body
  let rawBody: string
  try {
    rawBody = await c.req.text()
  } catch (e) {
    await db.logRequest({
      endpoint: "budget-inputs",
      status: "body_read_error",
      statusCode: 400,
      errorMessage: e instanceof Error ? e.message : String(e),
      correlationId,
    })
    return c.json({ error: "Failed to read request body" }, 400)
  }

  // 2. Try to parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch (e) {
    await db.logRequest({
      endpoint: "budget-inputs",
      status: "json_parse_error",
      statusCode: 400,
      errorMessage: e instanceof Error ? e.message : String(e),
      rawBody,
      correlationId,
    })
    return c.json({ error: "Invalid JSON" }, 400)
  }

  // 3. Validate with Zod
  const validation = EvaluateRequestSchema.safeParse(parsed)
  if (!validation.success) {
    await db.logRequest({
      endpoint: "budget-inputs",
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

  // 4. Dispatch to workflow
  const callData = validation.data

  await db.logRequest({
    endpoint: "budget-inputs",
    callId: callData.call_id,
    status: "received",
    correlationId,
  })

  const instanceId = `${callData.call_id}-budget_inputs`

  try {
    const instance = await c.env.EVALUATION_WORKFLOW.create({
      id: instanceId,
      params: { moduleName: MODULE_NAMES.BUDGET_INPUTS, callData, correlationId },
    })

    return c.json({
      call_id: callData.call_id,
      module: "budget_inputs",
      correlation_id: correlationId,
      workflow_instance_id: instance.id,
      status: "queued",
      timestamp: new Date().toISOString(),
    }, 202)
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) {
      return c.json({
        call_id: callData.call_id,
        module: "budget_inputs",
        workflow_instance_id: instanceId,
        status: "already_exists",
        message: "Evaluation already submitted for this call_id",
      }, 409)
    }
    throw e
  }
})

budgetInputsRoutes.post(
  "/evaluate/budget-inputs/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const correlationId = c.get("correlationId") ?? crypto.randomUUID()
    const instances = await Promise.all(
      calls.map(callData =>
        c.env.EVALUATION_WORKFLOW.create({
          id: `${callData.call_id}-budget_inputs`,
          params: { moduleName: MODULE_NAMES.BUDGET_INPUTS, callData, correlationId },
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

export { budgetInputsRoutes }
