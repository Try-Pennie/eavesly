import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { FullQASchema, type FullQAResult } from "../../schemas/full-qa"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/full-qa.txt"

export const fullQAModule: EvalModule = {
  name: MODULE_NAMES.FULL_QA,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = `Please evaluate the following call transcript:\n\n${transcript}`

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      FullQASchema,
    )

    const hasViolation = result.call_overview.manager_review_required

    return {
      module_name: MODULE_NAMES.FULL_QA,
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.MANAGER_ESCALATION : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: MODULE_NAMES.FULL_QA,
        violation_type: VIOLATION_TYPES.MANAGER_ESCALATION,
        call_id: callId,
        result: result.result,
      },
    ]
  },
}
