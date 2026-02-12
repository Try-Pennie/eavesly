import type { EvalModule, ModuleResult, Alert, ModuleConfig } from "./types"
import type { EvaluateRequest } from "../schemas/requests"
import type { LLMClient } from "../services/llm-client"
import type { DatabaseService } from "../services/database"
import { fullQAModule } from "./full-qa/module"
import { budgetInputsModule } from "./budget-inputs/module"
import { warmTransferModule } from "./warm-transfer/module"
import { log } from "../utils/logger"

const ALL_MODULES: EvalModule[] = [
  fullQAModule,
  budgetInputsModule,
  warmTransferModule,
]

export interface ModuleError {
  module_name: string
  error: string
}

export interface PipelineResult {
  results: ModuleResult[]
  alerts: Alert[]
  skippedModules: string[]
  failedModules: ModuleError[]
}

async function resolveModules(
  callData: EvaluateRequest,
  db: DatabaseService,
): Promise<{ modules: EvalModule[]; skipped: string[] }> {
  const configs = await db.getModuleConfigs()
  const modules: EvalModule[] = []
  const skipped: string[] = []

  const talkTime = callData.transcript.metadata.talk_time ?? callData.transcript.metadata.duration
  const disposition = callData.transcript.metadata.disposition
  const campaignName = callData.transcript.metadata.campaign_name

  for (const module of ALL_MODULES) {
    const config = configs.find((c) => c.module_name === module.name)

    if (!config || !config.enabled) {
      skipped.push(module.name)
      continue
    }

    if (talkTime < config.min_talk_time) {
      skipped.push(module.name)
      continue
    }

    if (
      config.trigger_dispositions &&
      !config.trigger_dispositions.includes(disposition)
    ) {
      skipped.push(module.name)
      continue
    }

    if (
      config.trigger_campaigns &&
      campaignName &&
      !config.trigger_campaigns.includes(campaignName)
    ) {
      skipped.push(module.name)
      continue
    }

    modules.push(module)
  }

  return { modules, skipped }
}

export async function runPipeline(
  callData: EvaluateRequest,
  transcript: string,
  llm: LLMClient,
  db: DatabaseService,
): Promise<PipelineResult> {
  const { modules: modulesToRun, skipped: skippedModules } =
    await resolveModules(callData, db)

  log("info", "Pipeline resolved modules", {
    running: modulesToRun.map((m) => m.name),
    skipped: skippedModules,
    callId: callData.call_id,
  })

  if (modulesToRun.length === 0) {
    return { results: [], alerts: [], skippedModules, failedModules: [] }
  }

  const settled = await Promise.allSettled(
    modulesToRun.map((m) => m.evaluate(transcript, callData, llm)),
  )

  const results: ModuleResult[] = []
  const alerts: Alert[] = []
  const failedModules: ModuleError[] = []

  settled.forEach((outcome, i) => {
    const module = modulesToRun[i]
    if (outcome.status === "fulfilled") {
      results.push(outcome.value)
      alerts.push(...module.extractAlerts(outcome.value, callData.call_id))
    } else {
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason)
      log("error", "Module evaluation failed", {
        module: module.name,
        callId: callData.call_id,
        error: errorMsg,
      })
      failedModules.push({ module_name: module.name, error: errorMsg })
    }
  })

  return { results, alerts, skippedModules, failedModules }
}
