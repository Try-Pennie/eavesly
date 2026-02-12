import type { z } from "zod"
import type { EvaluateRequest } from "../schemas/requests"
import type { LLMClient } from "../services/llm-client"

export interface ModuleResult {
  module_name: string
  result: unknown
  has_violation: boolean
  violation_type: string | null
  processing_time_ms: number
}

export interface Alert {
  module_name: string
  violation_type: string
  call_id: string
  result: unknown
}

export interface ModuleConfig {
  module_name: string
  enabled: boolean
  trigger_dispositions: string[] | null
  trigger_campaigns: string[] | null
  min_talk_time: number
  config_json: Record<string, unknown>
}

export interface EvalModule {
  name: string
  evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult>
  extractAlerts(result: ModuleResult, callId: string): Alert[]
}
