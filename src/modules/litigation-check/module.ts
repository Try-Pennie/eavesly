import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { LitigationCheckSchema } from "../../schemas/litigation-check"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/litigation-check.txt"

export const litigationCheckModule: EvalModule = {
  name: MODULE_NAMES.LITIGATION_CHECK,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = buildUserPrompt(
      "Please evaluate the following call transcript for litigation, delinquent account, or collections compliance:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      LitigationCheckSchema,
      "litigation_check_evaluation",
    )

    // Server-side recount — don't trust LLM arithmetic
    const actualViolation =
      result.litigation_discussed && !result.agent_communicated_restriction
    result.violation = actualViolation

    return {
      module_name: MODULE_NAMES.LITIGATION_CHECK,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.LITIGATION_CHECK : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(MODULE_NAMES.LITIGATION_CHECK, VIOLATION_TYPES.LITIGATION_CHECK, result, callId, agentId, callData),
}
