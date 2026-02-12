import type { Context } from "hono"
import type { AppEnv } from "../types/env"
import type { EvalModule, ModuleResult } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import type { LLMClient } from "../services/llm-client"
import type { DatabaseService } from "../services/database"
import { MODULE_NAMES } from "../modules/constants"
import { dispatchAlerts } from "../services/alerts"
import { log } from "../utils/logger"

function createSemaphore(limit: number) {
  let active = 0
  const queue: (() => void)[] = []

  return {
    async acquire<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => queue.push(resolve))
      }
      active++
      try {
        return await fn()
      } finally {
        active--
        queue.shift()?.()
      }
    },
  }
}

const LLM_CONCURRENCY = 5

export async function evaluateAndRespond(
  c: Context<AppEnv>,
  module: EvalModule,
  callData: EvaluateRequest,
  llm: LLMClient,
  db: DatabaseService,
): Promise<Response> {
  const correlationId = c.get("correlationId") ?? crypto.randomUUID()
  const start = Date.now()

  log("info", `${module.name} evaluation started`, {
    correlationId,
    callId: callData.call_id,
    agentId: callData.agent_id,
  })

  const result = await module.evaluate(
    callData.transcript.transcript,
    callData,
    llm,
  )

  const alerts = module.extractAlerts(result, callData.call_id, callData.agent_id)
  const alertDispatched = alerts.length > 0

  await db.storeModuleResult(callData.call_id, result, alertDispatched)

  if (module.name === MODULE_NAMES.FULL_QA) {
    await db.storeQAResult(
      callData.call_id,
      result.result,
      result.processing_time_ms,
    )
  }

  if (alertDispatched) {
    dispatchAlerts(alerts, c.executionCtx, c.env)
  }

  const processingTimeMs = Date.now() - start

  return c.json({
    call_id: callData.call_id,
    module: module.name,
    correlation_id: correlationId,
    timestamp: new Date().toISOString(),
    processing_time_ms: processingTimeMs,
    result: result.result,
    has_violation: result.has_violation,
    violation_type: result.violation_type,
    alert_dispatched: alertDispatched,
  })
}

export async function batchEvaluateAndRespond(
  c: Context<AppEnv>,
  module: EvalModule,
  calls: EvaluateRequest[],
  llm: LLMClient,
  db: DatabaseService,
): Promise<Response> {
  const correlationId = c.get("correlationId") ?? crypto.randomUUID()
  const start = Date.now()

  log("info", `${module.name} batch evaluation started`, {
    correlationId,
    batchSize: calls.length,
  })

  const semaphore = createSemaphore(LLM_CONCURRENCY)

  const settled = await Promise.allSettled(
    calls.map((callData) =>
      semaphore.acquire(async () => {
        const result = await module.evaluate(
          callData.transcript.transcript,
          callData,
          llm,
        )

        const alerts = module.extractAlerts(result, callData.call_id, callData.agent_id)
        const alertDispatched = alerts.length > 0

        await db.storeModuleResult(callData.call_id, result, alertDispatched)

        if (module.name === MODULE_NAMES.FULL_QA) {
          await db.storeQAResult(
            callData.call_id,
            result.result,
            result.processing_time_ms,
          )
        }

        if (alertDispatched) {
          dispatchAlerts(alerts, c.executionCtx, c.env)
        }

        return {
          call_id: callData.call_id,
          module: module.name,
          result: result.result,
          has_violation: result.has_violation,
          violation_type: result.violation_type,
          alert_dispatched: alertDispatched,
          processing_time_ms: result.processing_time_ms,
        }
      }),
    ),
  )

  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return { status: "success" as const, ...outcome.value }
    }
    return {
      status: "error" as const,
      call_id: calls[i].call_id,
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
}
