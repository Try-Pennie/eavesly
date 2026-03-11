import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { FullQASchema } from "../../schemas/full-qa"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/full-qa.txt"

export const fullQAModule: EvalModule = {
  name: MODULE_NAMES.FULL_QA,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = buildUserPrompt(
      "Please evaluate the following call transcript:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      FullQASchema,
      "full_qa_evaluation",
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

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(MODULE_NAMES.FULL_QA, VIOLATION_TYPES.MANAGER_ESCALATION, result, callId, agentId, callData),
}
