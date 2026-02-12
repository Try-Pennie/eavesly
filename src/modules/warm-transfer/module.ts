import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  WarmTransferSchema,
  type WarmTransferResult,
} from "../../schemas/warm-transfer"
import systemPrompt from "../../../prompts/warm-transfer.txt"

export const warmTransferModule: EvalModule = {
  name: "warm_transfer",

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
    )

    const hasViolation = result.warm_transfer_compliance.warm_transfer_violation

    return {
      module_name: "warm_transfer",
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? "warm_transfer" : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: "warm_transfer",
        violation_type: "warm_transfer",
        call_id: callId,
        result: result.result,
      },
    ]
  },
}
