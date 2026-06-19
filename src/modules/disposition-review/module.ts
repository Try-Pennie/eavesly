import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { DispositionAnalysisSchema } from "../../schemas/disposition-review"
import { buildDispositionReview } from "./logic"
import { MODULE_NAMES } from "../constants"
import systemPrompt from "../../../prompts/disposition-review.txt"

export const dispositionReviewModule: EvalModule = {
  name: MODULE_NAMES.DISPOSITION_REVIEW,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    // Authoritative current disposition comes from call metadata, never the LLM.
    const currentDisposition = callData.transcript.metadata.disposition ?? null

    const userPrompt = buildUserPrompt(
      `The CRM currently has this call dispositioned as: "${currentDisposition ?? "(none / unknown)"}".\n\nReview the following call transcript and determine whether that disposition accurately reflects what happened. Suggest the most accurate disposition from the taxonomy in your instructions, cite evidence, and assess your confidence:`,
      transcript,
      callHistory,
    )

    const analysis = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      DispositionAnalysisSchema,
      "disposition_review_evaluation",
    )

    // Server assembles the full contract: permission category, the always-false
    // auto-update rule, and the recommended action are all derived here. The
    // full result is still stored in result_json for internal test/debugging.
    const result = buildDispositionReview(analysis, currentDisposition)

    // TEMPORARY (production-test suppression): while disposition-review is being
    // validated in production, managers must NOT see or be alerted on its
    // results. The frontend keys alert queue/detail rows off has_violation, and
    // alert dispatch keys off extractAlerts, so we report this module as
    // non-violating regardless of result.permission.requires_human_review.
    // The internal contract (permission/recommended_action) remains intact in
    // `result`. Restore `result.permission.requires_human_review` here when
    // disposition-review is ready to surface to managers.
    return {
      module_name: MODULE_NAMES.DISPOSITION_REVIEW,
      result,
      has_violation: false,
      violation_type: null,
      processing_time_ms: Date.now() - start,
    }
  },

  // TEMPORARY (production-test suppression): no alerts are emitted for
  // disposition-review, so alert_sent stays false and no Slack/webhook
  // notification fires. Restore the extractAlerts(...) call below when ready to
  // surface disposition-review to managers.
  extractAlerts: () => [],
}
