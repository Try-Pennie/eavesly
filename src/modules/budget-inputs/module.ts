import type { EvalModule, ModuleResult } from "../types"
import { extractAlerts } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  BudgetInputsSchema,
  BUDGET_REQUIRED_FIELDS,
  BUDGET_ALL_FIELDS,
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

    // Server-side recount — don't trust LLM arithmetic
    const actualRequiredSkipped = BUDGET_REQUIRED_FIELDS.filter(
      (field) => !result[field].collected
    ).length
    const actualTotalSkipped = BUDGET_ALL_FIELDS.filter(
      (field) => !result[field].collected
    ).length
    const actualViolation = actualRequiredSkipped >= 2

    result.budget_collection_overview.required_items_skipped = actualRequiredSkipped
    result.budget_collection_overview.items_skipped = actualTotalSkipped
    result.budget_collection_overview.items_collected = BUDGET_ALL_FIELDS.length - actualTotalSkipped
    result.budget_collection_overview.budget_compliance_violation = actualViolation

    return {
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.BUDGET_COMPLIANCE : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(MODULE_NAMES.BUDGET_INPUTS, VIOLATION_TYPES.BUDGET_COMPLIANCE, result, callId, agentId, callData),
}
