import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
} from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { fullQAModule } from "../modules/full-qa/module"
import { auth } from "../middleware/auth"
import { evaluateAndRespond, batchEvaluateAndRespond } from "./shared"

const fullQARoutes = new Hono<AppEnv>()

fullQARoutes.use("*", auth)

fullQARoutes.post(
  "/evaluate/full-qa",
  zValidator("json", EvaluateRequestSchema),
  async (c) => {
    const callData = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return evaluateAndRespond(c, fullQAModule, callData, llm, db)
  },
)

fullQARoutes.post(
  "/evaluate/full-qa/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return batchEvaluateAndRespond(c, fullQAModule, calls, llm, db)
  },
)

export { fullQARoutes }
