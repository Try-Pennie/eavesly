import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { GotaCheckModelResponseSchema } from "../../schemas/gota-check"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { finalizeGotaCheck, resolveGotaTypeFromLeadContext } from "./logic"
import systemPrompt from "../../../prompts/gota-check.txt"

/**
 * Achieve combined PSC + GOTA check — internal Pennie compliance module on the
 * Pennie *handling agent*. Under the vF 8.6.26 combined guide, a completed
 * standard (green/red) signing call must include all nine required disclosures
 * read verbatim and in order plus a guided signing walkthrough. The server owns
 * every consequential decision (evidence verification, disclosure order,
 * violation) via `finalizeGotaCheck`; the model's arithmetic is never trusted.
 *
 * California is fail-closed: any California signal suppresses the violation
 * (stored for review) until a reliable Day-4 identifier exists. Coaching beats
 * are informational and never alert on their own.
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

    // Deterministic lead-context guide selection overrides the model's
    // transcript-derived gota_type. For California this only fixes the guide
    // variant — call_stage (initial vs Day-4) is still classified from the
    // transcript, but California is suppressed regardless.
    const resolvedGotaType = resolveGotaTypeFromLeadContext(callData.lead_context)
    const guideContext = resolvedGotaType
      ? `\n\nRegal lead metadata identifies the authoritative guide variant as ${resolvedGotaType}. Use that gota_type even when transcript wording is ambiguous.${resolvedGotaType === "fdr_california" ? " For California this metadata does not identify whether this is the initial signing or the Day-4 execution call; classify call_stage from the transcript and prior-call history." : ""}`
      : ""

    const userPrompt = buildUserPrompt(
      `Please evaluate the following Achieve enrollment call transcript against the vF 8.6.26 combined disclosure + GOTA signing guide:${guideContext}`,
      transcript,
      callHistory,
    )

    const modelResult = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      GotaCheckModelResponseSchema,
      "gota_check_evaluation",
    )

    const result = finalizeGotaCheck(modelResult, transcript, resolvedGotaType)
    const actualViolation = result.violation

    return {
      module_name: MODULE_NAMES.GOTA_CHECK,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.GOTA_CHECK : null,
      processing_time_ms: Date.now() - start,
    }
  },

  // Soft launch: persist every assessment (including has_violation) for internal
  // accuracy review, but create no Alert objects. EvaluationWorkflow therefore
  // stores alert_sent=false and neither manager queues nor Slack receive GOTA.
  // Restore alert extraction only after the rollout cohort is fully onboarded
  // and stored results have been validated.
  extractAlerts: () => [],
}
