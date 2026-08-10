import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { GotaCheckModelResponseSchema } from "../../schemas/gota-check"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { finalizeGotaCheck, resolveGotaTypeFromLeadContext } from "./logic"
import systemPrompt from "../../../prompts/gota-check.txt"

/**
 * Achieve GOTA (Going Over The Agreement) check — internal Pennie compliance
 * module. Fires an alert when the client signed the enrollment agreement on the
 * call WITHOUT the mandatory guided GOTA signing walkthrough. Key-beat coverage
 * is recorded for coaching but never alerts on its own.
 */
export const gotaCheckModule: EvalModule = {
  name: MODULE_NAMES.GOTA_CHECK,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const expectedGotaType = resolveGotaTypeFromLeadContext(callData.lead_context)
    const guideContext = expectedGotaType
      ? `\n\nRegal lead metadata identifies the authoritative guide variant as ${expectedGotaType}. Use that gota_type even if transcript wording is ambiguous. For California, this metadata does not identify whether this is the initial or Day-4 call; classify call_stage only from the transcript and prior-call history.`
      : ""
    const userPrompt = buildUserPrompt(
      `Please evaluate the following Achieve enrollment call transcript for GOTA (Going Over The Agreement) signing-walkthrough compliance:${guideContext}`,
      transcript,
      callHistory,
    )

    const modelResult = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      GotaCheckModelResponseSchema,
      "gota_check_evaluation",
    )
    const result = finalizeGotaCheck(modelResult, transcript, expectedGotaType)
    const actualViolation = result.violation

    return {
      module_name: MODULE_NAMES.GOTA_CHECK,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.GOTA_CHECK : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(MODULE_NAMES.GOTA_CHECK, VIOLATION_TYPES.GOTA_CHECK, result, callId, agentId, callData),
}
