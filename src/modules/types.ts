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
  agent_email?: string
  contact_name?: string
  recording_link?: string
  transcript_url?: string
  sfdc_lead_id?: string
  call_duration?: number
}

export interface EvalModule {
  name: string
  evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult>
  extractAlerts(result: ModuleResult, callId: string, agentId: string, callData?: EvaluateRequest): Alert[]
}

export function extractAlerts(
  moduleName: string,
  violationType: string,
  result: ModuleResult,
  callId: string,
  agentId: string,
  callData?: EvaluateRequest,
): Alert[] {
  if (!result.has_violation) return []

  return [
    {
      module_name: moduleName,
      violation_type: violationType,
      call_id: callId,
      agent_id: agentId,
      result: result.result,
      agent_email: callData?.agent_email,
      contact_name: callData?.contact_name,
      recording_link: callData?.recording_link,
      transcript_url: callData?.transcript_url,
      sfdc_lead_id: callData?.sfdc_lead_id,
      call_duration: callData?.transcript.metadata.duration,
    },
  ]
}
