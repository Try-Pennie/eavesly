import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  BudgetInputsSchema,
  type BudgetInputsResult,
} from "../../schemas/budget-inputs"
import { BUDGET_INPUTS_SYSTEM_PROMPT } from "./prompt"

export const budgetInputsModule: EvalModule = {
  name: "budget_inputs",

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = `Please evaluate the following enrollment call transcript for budget input compliance:\n\n${transcript}`

    const result = await llm.getStructuredResponse(
      BUDGET_INPUTS_SYSTEM_PROMPT,
      userPrompt,
      BudgetInputsSchema,
    )

    const hasViolation = result.budget_collection_overview.budget_compliance_violation

    return {
      module_name: "budget_inputs",
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? "budget_compliance" : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: "budget_inputs",
        violation_type: "budget_compliance",
        call_id: callId,
        result: result.result,
      },
    ]
  },
}
