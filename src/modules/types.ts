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
  agent_id: string
  result: unknown
}

export interface EvalModule {
  name: string
  evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult>
  extractAlerts(result: ModuleResult, callId: string, agentId: string): Alert[]
}
