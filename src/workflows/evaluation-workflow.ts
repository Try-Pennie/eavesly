import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers"
import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import { getModule } from "./module-registry"
import { createLLMClient } from "../services/llm-client"
import { DatabaseService } from "../services/database"
import { processAlert } from "../services/alerts"
import { log } from "../utils/logger"

type EvaluationParams = {
  moduleName: string
  callData: EvaluateRequest
  correlationId: string
}

export class EvaluationWorkflow extends WorkflowEntrypoint<Bindings, EvaluationParams> {
  async run(event: WorkflowEvent<EvaluationParams>, step: WorkflowStep) {
    const { moduleName, callData, correlationId } = event.payload
    const mod = getModule(moduleName)

    // Step 1: LLM evaluation (the expensive step)
    const result = await step.do("evaluate-llm", {
      retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    }, async () => {
      const llm = createLLMClient(this.env)
      return await mod.evaluate(callData.transcript.transcript, callData, llm)
    })

    // Step 2: Store result in Supabase
    const alerts = await step.do("store-result", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "1 minute",
    }, async () => {
      const db = new DatabaseService(this.env)
      const alerts = mod.extractAlerts(result, callData.call_id, callData.agent_id, callData)
      await db.storeModuleResult(callData.call_id, result, alerts.length > 0, callData)
      return alerts
    })

    // Step 3: Dispatch alerts (Slack webhook) — best-effort, non-fatal
    if (alerts.length > 0) {
      await step.do("dispatch-alerts", {
        retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
        timeout: "1 minute",
      }, async () => {
        for (const alert of alerts) {
          try {
            await processAlert(alert, this.env)
          } catch (err) {
            log("error", "Alert dispatch failed (non-fatal)", {
              callId: callData.call_id,
              module: moduleName,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      })
    }

    // Step 4: Log completion
    await step.do("log-completion", {
      retries: { limit: 2, delay: "1 second", backoff: "constant" },
      timeout: "30 seconds",
    }, async () => {
      const db = new DatabaseService(this.env)
      await db.logRequest({
        endpoint: "budget-inputs",
        callId: callData.call_id,
        status: "workflow_completed",
        statusCode: 200,
        correlationId,
      })
    })

    return {
      call_id: callData.call_id,
      module: moduleName,
      has_violation: result.has_violation,
      violation_type: result.violation_type,
      processing_time_ms: result.processing_time_ms,
    }
  }
}
