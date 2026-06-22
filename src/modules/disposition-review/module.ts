import type { EvalModule, ModuleResult, CallHistoryContext, Disposition } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { DispositionAnalysisSchema } from "../../schemas/disposition-review"
import { buildDispositionReview } from "./logic"
import { renderSystemPrompt, type DispositionAudience } from "./taxonomy"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import promptTemplate from "../../../prompts/disposition-review.txt"

export const dispositionReviewModule: EvalModule = {
  name: MODULE_NAMES.DISPOSITION_REVIEW,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
    dispositions?: Disposition[],
    audience: DispositionAudience = "human",
  ): Promise<ModuleResult> {
    const start = Date.now()

    // Authoritative current disposition comes from call metadata, never the LLM.
    const currentDisposition = callData.transcript.metadata.disposition ?? null
    const catalog = dispositions ?? []

    // Inject the live CRM disposition catalog so the suggestable taxonomy never
    // drifts from the Dispositions admin screen, scoped to who dispositioned the call.
    const systemPrompt = renderSystemPrompt(promptTemplate, catalog, audience)

    // Call timing is a strong signal for whether a real conversation happened —
    // near-zero talk time means voicemail/no-answer regardless of the disposition.
    const meta = callData.transcript.metadata
    const timing =
      `Call duration: ${Math.round(meta.duration)}s` +
      (meta.talk_time != null ? `, talk time: ${Math.round(meta.talk_time)}s` : "") +
      "."

    const userPrompt = buildUserPrompt(
      `The CRM currently has this call dispositioned as: "${currentDisposition ?? "(none / unknown)"}". ${timing}\n\nReview the following call transcript and determine whether that disposition accurately reflects what happened. Treat the call duration and talk time as evidence — a very short call or near-zero talk time means no real conversation took place, whatever the disposition says. Suggest the most accurate disposition from the taxonomy in your instructions, cite evidence, and assess your confidence:`,
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
    // auto-update rule, and the recommended action are all derived here.
    const result = buildDispositionReview(analysis, currentDisposition)

    // A mis-disposition needing human attention is exactly the case where the
    // assembled contract requires human review.
    const hasViolation = result.permission.requires_human_review

    return {
      module_name: MODULE_NAMES.DISPOSITION_REVIEW,
      result,
      has_violation: hasViolation,
      violation_type: hasViolation ? VIOLATION_TYPES.MIS_DISPOSITION : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(
      MODULE_NAMES.DISPOSITION_REVIEW,
      VIOLATION_TYPES.MIS_DISPOSITION,
      result,
      callId,
      agentId,
      callData,
    ),
}
