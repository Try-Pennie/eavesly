import { z } from "zod"
import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { AchieveWelcomeCallQASchema } from "../../schemas/achieve-welcome-call-qa"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/achieve-welcome-call-qa.txt"

// partner_id and script_version are not columns in eavesly_module_results;
// they live in result_json so they are preserved and queryable without a migration.
const PARTNER_ID = "achieve" as const
const SCRIPT_VERSION = "fdr_wholesale_db_pilot_v0" as const

// Allow model to omit partner_id/script_version; we stamp them unconditionally after.
const EvalSchema = AchieveWelcomeCallQASchema.extend({
  partner_id: z.string().optional(),
  script_version: z.string().optional(),
})

export const achieveWelcomeCallQAModule: EvalModule = {
  name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,

  async evaluate(
    transcript: string,
    _callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = buildUserPrompt(
      "Please evaluate the following Achieve/FDR welcome call transcript for script adherence:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      EvalSchema,
      "achieve_welcome_call_qa_evaluation",
    )

    // Always stamp partner_id and script_version regardless of what the model returns
    const stamped = { ...result, partner_id: PARTNER_ID, script_version: SCRIPT_VERSION }
    const hasViolation = stamped.script_adherence.violation

    return {
      module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      result: stamped,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.ACHIEVE_WELCOME_CALL : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(
      MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
      VIOLATION_TYPES.ACHIEVE_WELCOME_CALL,
      result,
      callId,
      agentId,
      callData,
    ),
}
