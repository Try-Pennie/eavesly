import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import type { AppEnv } from "../types/env"
import { EvaluateRequestSchema } from "../schemas/requests"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { runPipeline } from "../modules/router"
import { dispatchAlerts } from "../services/alerts"
import { log } from "../utils/logger"
import { auth } from "../middleware/auth"

const app = new Hono<AppEnv>()

app.use("*", auth)

app.post(
  "/evaluate",
  zValidator("json", EvaluateRequestSchema),
  async (c) => {
    const callData = c.req.valid("json")
    const correlationId = c.get("correlationId") ?? crypto.randomUUID()
    const start = Date.now()

    const talkTime =
      callData.transcript.metadata.talk_time ??
      callData.transcript.metadata.duration

    log("info", "Evaluation started", {
      correlationId,
      callId: callData.call_id,
      talkTime,
      disposition: callData.transcript.metadata.disposition,
    })

    const llm = createLLMClient(c.env)
    const db = new DatabaseService(c.env)

    const pipelineResult = await runPipeline(
      callData,
      callData.transcript.transcript,
      llm,
      db,
    )

    // Store results
    for (const result of pipelineResult.results) {
      await db.storeModuleResult(
        callData.call_id,
        result,
        pipelineResult.alerts.some(
          (a) => a.module_name === result.module_name,
        ),
      )

      // Backward compat: also write full_qa results to legacy table
      if (result.module_name === "full_qa") {
        await db.storeQAResult(
          callData.call_id,
          result.result,
          result.processing_time_ms,
        )
      }
    }

    // Dispatch alerts asynchronously
    if (pipelineResult.alerts.length > 0) {
      dispatchAlerts(pipelineResult.alerts, c.executionCtx)
    }

    const processingTimeMs = Date.now() - start

    return c.json({
      call_id: callData.call_id,
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
      processing_time_ms: processingTimeMs,
      modules_run: pipelineResult.results.map((r) => r.module_name),
      modules_skipped: pipelineResult.skippedModules,
      results: Object.fromEntries(
        pipelineResult.results.map((r) => [
          r.module_name,
          {
            result: r.result,
            has_violation: r.has_violation,
            violation_type: r.violation_type,
            processing_time_ms: r.processing_time_ms,
          },
        ]),
      ),
      alerts: pipelineResult.alerts.map((a) => ({
        module: a.module_name,
        type: a.violation_type,
      })),
      modules_failed: pipelineResult.failedModules,
    })
  },
)

export { app as evaluateRoutes }
