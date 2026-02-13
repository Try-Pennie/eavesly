import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
} from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { budgetInputsModule } from "../modules/budget-inputs/module"
import { auth } from "../middleware/auth"
import { evaluateAndRespond, batchEvaluateAndRespond } from "./shared"

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

  // 4. Process normally
  const callData = validation.data
  const llm = createLLMClient(c.env)

  await db.logRequest({
    endpoint: "budget-inputs",
    callId: callData.call_id,
    status: "received",
    correlationId,
  })

  try {
    const response = await evaluateAndRespond(
      c,
      budgetInputsModule,
      callData,
      llm,
      db,
    )
    await db.logRequest({
      endpoint: "budget-inputs",
      callId: callData.call_id,
      status: "success",
      statusCode: 200,
      correlationId,
    })
    return response
  } catch (e) {
    await db.logRequest({
      endpoint: "budget-inputs",
      callId: callData.call_id,
      status: "processing_error",
      statusCode: 500,
      errorMessage: e instanceof Error ? e.message : String(e),
      correlationId,
    })
    throw e
  }
})

budgetInputsRoutes.post(
  "/evaluate/budget-inputs/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return batchEvaluateAndRespond(c, budgetInputsModule, calls, llm, db)
  },
)

export { budgetInputsRoutes }
