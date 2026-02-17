import type { EvalModule, ModuleResult, Alert } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  BudgetInputsSchema,
  type BudgetInputsResult,
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

    const hasViolation = actualViolation

    return {
      module_name: MODULE_NAMES.BUDGET_INPUTS,
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.BUDGET_COMPLIANCE : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts(result: ModuleResult, callId: string, agentId: string, callData?: EvaluateRequest): Alert[] {
    if (!result.has_violation) return []

    return [
      {
        module_name: MODULE_NAMES.BUDGET_INPUTS,
        violation_type: VIOLATION_TYPES.BUDGET_COMPLIANCE,
        call_id: callId,
        agent_id: agentId,
        result: result.result,
        agent_email: callData?.agent_email,
        contact_name: callData?.contact_name,
        recording_link: callData?.recording_link,
        transcript_url: callData?.transcript_url,
        sfdc_lead_id: callData?.sfdc_lead_id,
      },
    ]
  },
}
