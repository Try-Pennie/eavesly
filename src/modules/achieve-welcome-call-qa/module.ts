import { z } from "zod"
import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { AchieveWelcomeCallQASchema } from "../../schemas/achieve-welcome-call-qa"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { segmentWelcomeCall } from "./segment"
import systemPrompt from "../../../prompts/achieve-welcome-call-qa.txt"

// partner_id and script_version are not columns in eavesly_module_results;
// they live in result_json so they are preserved and queryable without a migration.
const PARTNER_ID = "achieve" as const
const SCRIPT_VERSION = "fdr_wholesale_db_pilot_v0" as const
const SEGMENT_TYPE = "fdr_disclosure_and_welcome_call" as const

// partner_id/script_version/transcript_segment are stamped deterministically by the
// module after the call, so the model is allowed to omit them.
const EvalSchema = AchieveWelcomeCallQASchema.extend({
  partner_id: z.string().optional(),
  script_version: z.string().optional(),
  transcript_segment: AchieveWelcomeCallQASchema.shape.transcript_segment.optional(),
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

    // Grade only the actual Achieve/FDR segment (post-handoff), beginning with the
    // Freedom disclosure line when present and continuing through the live welcome call.
    const seg = segmentWelcomeCall(transcript)

    const preamble = [
      "You are grading ONLY the extracted Achieve/FDR disclosure and welcome-call segment below",
      "(the portion of the call after the Pennie enrollment handoff; it may begin with the automated Freedom disclosure line before the live client success advocate joins).",
      "Do NOT give credit for, and do NOT infer required elements from, any earlier Pennie",
      "sales, enrollment, or disclosure content — that content is intentionally excluded here.",
      seg.used_full_transcript_fallback
        ? "NOTE: no welcome-call handoff marker was found, so the FULL transcript is shown as a fallback. Lower your assessment_confidence accordingly."
        : `Segment located via marker "${seg.marker}" (segmentation confidence: ${seg.segmentation_confidence}).`,
      "",
      "Please evaluate the following Achieve/FDR segment for script adherence:",
    ].join(" ")

    const userPrompt = buildUserPrompt(preamble, seg.segment, callHistory)

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      EvalSchema,
      "achieve_welcome_call_qa_evaluation",
    )

    // Stamp partner_id/script_version and deterministic segmentation metadata,
    // regardless of what the model returns.
    const stamped = {
      ...result,
      partner_id: PARTNER_ID,
      script_version: SCRIPT_VERSION,
      transcript_segment: {
        segment_type: SEGMENT_TYPE,
        start_line: seg.start_line,
        marker: seg.marker,
        segmentation_confidence: seg.segmentation_confidence,
        segmentation_score: seg.segmentation_score,
        used_full_transcript_fallback: seg.used_full_transcript_fallback,
      },
    }
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
