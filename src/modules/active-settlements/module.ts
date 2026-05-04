import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { ActiveSettlementsSchema } from "../../schemas/active-settlements"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/active-settlements.txt"

export const activeSettlementsModule: EvalModule = {
  name: MODULE_NAMES.ACTIVE_SETTLEMENTS,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = buildUserPrompt(
      "Please evaluate the following call transcript for active settlement negotiations and competitor enrollment:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      ActiveSettlementsSchema,
      "active_settlements_evaluation",
    )

    // Server-side recount — don't trust LLM arithmetic.
    // Alert fires whenever active settlements are detected; secondary checks
    // surface as alert payload context.
    const actualViolation = result.active_settlements_detected
    result.violation = actualViolation

    // Defensive: cancellation_confirmed must be "n/a" when not enrolled with competitor.
    if (result.enrolled_with_competitor === "no") {
      result.cancellation_confirmed = "n/a"
      result.cancellation_evidence_quote = ""
    }

    return {
      module_name: MODULE_NAMES.ACTIVE_SETTLEMENTS,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.ACTIVE_SETTLEMENTS : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(
      MODULE_NAMES.ACTIVE_SETTLEMENTS,
      VIOLATION_TYPES.ACTIVE_SETTLEMENTS,
      result,
      callId,
      agentId,
      callData,
    ),
}
