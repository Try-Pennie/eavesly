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

  extractAlerts(result: ModuleResult, callId: string): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: MODULE_NAMES.WARM_TRANSFER,
        violation_type: VIOLATION_TYPES.WARM_TRANSFER,
        call_id: callId,
        result: result.result,
      },
    ]
  },
}
