import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import { BatchEvaluateRequestSchema } from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { runPipeline } from "../modules/router"
import { dispatchAlerts } from "../services/alerts"
import { log } from "../utils/logger"
import { auth } from "../middleware/auth"

const app = new Hono<AppEnv>()

app.use("*", auth)

app.post(
  "/evaluate-batch",
  zValidator("json", BatchEvaluateRequestSchema),
  async (c) => {
    const { calls } = c.req.valid("json")
    const correlationId = c.get("correlationId") ?? crypto.randomUUID()
    const start = Date.now()

    log("info", "Batch evaluation started", {
      correlationId,
      batchSize: calls.length,
    })

    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)

    const settled = await Promise.allSettled(
      calls.map(async (callData) => {
        const pipelineResult = await runPipeline(
          callData,
          callData.transcript.transcript,
          llm,
          db,
        )

        for (const result of pipelineResult.results) {
          await db.storeModuleResult(
            callData.call_id,
            result,
            pipelineResult.alerts.some(
              (a) => a.module_name === result.module_name,
            ),
          )

          if (result.module_name === "full_qa") {
            await db.storeQAResult(
              callData.call_id,
              result.result,
              result.processing_time_ms,
            )
          }
        }

        if (pipelineResult.alerts.length > 0) {
          dispatchAlerts(pipelineResult.alerts, c.executionCtx)
        }

        return {
          call_id: callData.call_id,
          status: "success" as const,
          modules_run: pipelineResult.results.map((r) => r.module_name),
          alerts: pipelineResult.alerts.length,
        }
      }),
    )

    const results = settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") {
        return outcome.value
      }
      return {
        call_id: calls[i].call_id,
        status: "error" as const,
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      }
    })

    const successCount = results.filter((r) => r.status === "success").length

    return c.json({
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
      processing_time_ms: Date.now() - start,
      total: calls.length,
      success: successCount,
      failed: calls.length - successCount,
      success_rate: (successCount / calls.length) * 100,
      results,
    })
  },
)

export { app as batchRoutes }
