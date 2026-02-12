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

const app = new Hono<AppEnv>()

app.use("*", auth)

app.post(
  "/evaluate/budget-inputs",
  zValidator("json", EvaluateRequestSchema),
  async (c) => {
    const callData = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return evaluateAndRespond(c, budgetInputsModule, callData, llm, db)
  },
)

app.post(
  "/evaluate/budget-inputs/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return batchEvaluateAndRespond(c, budgetInputsModule, calls, llm, db)
  },
)

export { app as budgetInputsRoutes }
