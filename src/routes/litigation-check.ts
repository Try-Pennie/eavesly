import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
} from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { litigationCheckModule } from "../modules/litigation-check/module"
import { auth } from "../middleware/auth"
import { evaluateAndRespond, batchEvaluateAndRespond } from "./shared"

const litigationCheckRoutes = new Hono<AppEnv>()

litigationCheckRoutes.use("*", auth)

litigationCheckRoutes.post(
  "/evaluate/litigation-check",
  zValidator("json", EvaluateRequestSchema),
  async (c) => {
    const callData = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return evaluateAndRespond(c, litigationCheckModule, callData, llm, db)
  },
)

litigationCheckRoutes.post(
  "/evaluate/litigation-check/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return batchEvaluateAndRespond(c, litigationCheckModule, calls, llm, db)
  },
)

export { litigationCheckRoutes }
