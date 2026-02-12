import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  BudgetInputsSchema,
  type BudgetInputsResult,
} from "../../schemas/budget-inputs"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/budget-inputs.txt"

export const budgetInputsModule: EvalModule = {
  name: MODULE_NAMES.BUDGET_INPUTS,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = `Please evaluate the following enrollment call transcript for budget input compliance:\n\n${transcript}`

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      BudgetInputsSchema,
      "budget_inputs_evaluation",
    )

    const hasViolation = result.budget_collection_overview.budget_compliance_violation

    return {
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.BUDGET_COMPLIANCE : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
        call_id: callId,
        result: result.result,
      },
    ]
  },
}
