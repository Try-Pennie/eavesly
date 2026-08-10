import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { GotaCheckSchema } from "../../schemas/gota-check"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/gota-check.txt"

export const BEAT_LABELS: Record<string, string> = {
  fee_structure: "Fee structure (performance-based fees)",
  cancellation_rights: "Cancellation rights (cancel window + cancel anytime)",
  do_not_sign_page: "Cancellation notice DO-NOT-SIGN page",
  banking_readback: "Banking details read-back",
  ssn_verification: "SSN verification",
  wc_transfer_brief: "Warm-transfer brief to welcome team",
}

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

    const userPrompt = buildUserPrompt(
      "Please evaluate the following Achieve enrollment call transcript for GOTA (Going Over The Agreement) signing-walkthrough compliance:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      GotaCheckSchema,
      "gota_check_evaluation",
    )

    // Server-side recount — don't trust LLM arithmetic. Rebuild missing_beats
    // from the per-beat flags and recompute the violation from its definition:
    // signed on this call without a guided GOTA walkthrough. Missing beats are
    // informational only and never flip the violation.
    const missing: string[] = []
    if (!result.fee_structure_beat_covered) missing.push(BEAT_LABELS.fee_structure)
    if (!result.cancellation_rights_beat_covered) missing.push(BEAT_LABELS.cancellation_rights)
    if (!result.do_not_sign_page_beat_covered) missing.push(BEAT_LABELS.do_not_sign_page)
    if (!result.banking_readback_beat_covered) missing.push(BEAT_LABELS.banking_readback)
    if (!result.ssn_verification_beat_covered) missing.push(BEAT_LABELS.ssn_verification)
    if (!result.wc_transfer_brief_beat_covered) missing.push(BEAT_LABELS.wc_transfer_brief)

    const actualViolation = result.enrollment_completed && !result.gota_conducted

    result.missing_beats = missing
    result.violation = actualViolation

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
