import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
} from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { warmTransferModule } from "../modules/warm-transfer/module"
import { auth } from "../middleware/auth"
import { evaluateAndRespond, batchEvaluateAndRespond } from "./shared"

const warmTransferRoutes = new Hono<AppEnv>()

warmTransferRoutes.use("*", auth)

warmTransferRoutes.post(
  "/evaluate/warm-transfer",
  zValidator("json", EvaluateRequestSchema),
  async (c) => {
    const callData = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return evaluateAndRespond(c, warmTransferModule, callData, llm, db)
  },
)

warmTransferRoutes.post(
  "/evaluate/warm-transfer/batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)
    return batchEvaluateAndRespond(c, warmTransferModule, calls, llm, db)
  },
)

export { warmTransferRoutes }
