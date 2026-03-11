import type { EvaluateRequest } from "../schemas/requests"
import type { LLMClient } from "../services/llm-client"

export interface PriorCall {
  call_id: string
  started_at: string | null
  disposition: string | null
  direction: string | null
  talk_time: number | null
  agent_email: string | null
  campaign_name: string | null
  notes: string | null
  call_summary: string | null
  overall_score: string | null
  compliance_rating: string | null
}

export interface CallHistoryContext {
  total_prior_calls: number
  prior_calls: PriorCall[]
}

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
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult>
  extractAlerts(result: ModuleResult, callId: string, agentId: string, callData?: EvaluateRequest): Alert[]
}

export function buildUserPrompt(
  basePrompt: string,
  transcript: string,
  callHistory?: CallHistoryContext | null,
): string {
  let userPrompt = ""

  if (callHistory && callHistory.prior_calls.length > 0) {
    userPrompt += `<prior_call_history>
This is NOT the first interaction with this lead. There have been ${callHistory.total_prior_calls} prior call(s). Here are the most recent:

${callHistory.prior_calls.map((c, i) => `Call ${i + 1} (${c.started_at ?? "unknown date"}):
- Agent: ${c.agent_email ?? "unknown"}
- Direction: ${c.direction ?? "unknown"} | Disposition: ${c.disposition ?? "unknown"}
- Talk time: ${c.talk_time ? Math.round(c.talk_time / 60) + " min" : "unknown"}
- Campaign: ${c.campaign_name ?? "unknown"}
${c.call_summary ? `- Summary: ${c.call_summary}` : ""}
${c.notes ? `- Agent notes: ${c.notes}` : ""}`).join("\n\n")}
</prior_call_history>

Keep this history in mind when evaluating. The agent may reference prior conversations, skip steps already completed, or follow up on previous topics. Do not penalize the agent for not repeating steps that were handled in a prior call.

`
  }

  userPrompt += `${basePrompt}\n\n${transcript}`
  return userPrompt
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
