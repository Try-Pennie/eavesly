import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  WarmTransferSchema,
  type WarmTransferResult,
} from "../../schemas/warm-transfer"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/warm-transfer.txt"

export const warmTransferModule: EvalModule = {
  name: MODULE_NAMES.WARM_TRANSFER,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = `Please evaluate the following enrollment call transcript for warm transfer compliance and full QA:\n\n${transcript}`

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      WarmTransferSchema,
      "warm_transfer_evaluation",
    )

    const hasViolation = result.warm_transfer_compliance.warm_transfer_violation

    return {
      module_name: MODULE_NAMES.WARM_TRANSFER,
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.WARM_TRANSFER : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string, agentId: string, callData?: EvaluateRequest): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: MODULE_NAMES.WARM_TRANSFER,
        violation_type: VIOLATION_TYPES.WARM_TRANSFER,
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
  },
}
