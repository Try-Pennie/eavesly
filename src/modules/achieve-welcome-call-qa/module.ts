import { z } from "zod"
import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import { AchieveWelcomeCallQASchema } from "../../schemas/achieve-welcome-call-qa"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import { segmentWelcomeCall } from "./segment"
import { analyzeTransferExperience } from "./transfer-experience"
import systemPrompt from "../../../prompts/achieve-welcome-call-qa.txt"

// partner_id and script_version are not columns in eavesly_module_results;
// they live in result_json so they are preserved and queryable without a migration.
const PARTNER_ID = "achieve" as const
const SCRIPT_VERSION = "fdr_wholesale_db_pilot_v1" as const
const SEGMENT_TYPE = "fdr_disclosure_and_welcome_call" as const

// Partner, segmentation, and transfer-quality fields are stamped deterministically
// after the model returns, so the model may omit them.
const EvalSchema = AchieveWelcomeCallQASchema.extend({
  partner_id: z.string().optional(),
  script_version: z.string().optional(),
  transfer_experience: AchieveWelcomeCallQASchema.shape.transfer_experience.optional(),
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

    // Grade only the bounded live Achieve/FDR welcome-call interaction. IVR audio and
    // transfer-partner content before/after that interaction are excluded.
    const seg = segmentWelcomeCall(transcript)

    const segmentMeta = {
      segment_type: SEGMENT_TYPE,
      start_line: seg.start_line,
      end_line: seg.end_line,
      marker: seg.marker,
      segmentation_confidence: seg.segmentation_confidence,
      segmentation_score: seg.segmentation_score,
      used_full_transcript_fallback: seg.used_full_transcript_fallback,
      segment_found: seg.segment_found,
      skip_reason: seg.skip_reason,
      transfer_agent_lines: seg.transfer_agent_lines,
    }

    if (!seg.segment_found) {
      // No reliable Achieve/FDR boundary (mis-route or failed handoff). Never
      // send an unbounded transcript to the model — record the skip instead.
      return {
        module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
        result: {
          partner_id: PARTNER_ID,
          script_version: SCRIPT_VERSION,
          grading_skipped: true,
          skip_reason: seg.skip_reason,
          transcript_segment: segmentMeta,
        },
        has_violation: false,
        violation_type: null,
        processing_time_ms: Date.now() - start,
      }
    }

    const preamble = [
      "You are grading ONLY the bounded live Achieve/FDR welcome-call interaction below.",
      "Automated menu/disclosure audio and transfer-partner content before or after this interaction are intentionally excluded.",
      "Do NOT give credit for, and do NOT infer required elements from, content outside this segment.",
      `Segment located via marker "${seg.marker}" (segmentation confidence: ${seg.segmentation_confidence}).`,
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

    // A quote that isn't literally in the graded segment is fabricated or lifted
    // from outside the segment (e.g. Pennie-side content). Drop it before the
    // result reaches the external partner.
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
    const segmentNormalized = normalize(seg.segment)
    const verifiedQuotes = result.script_adherence.key_evidence_quotes.filter((q) => {
      // An empty/whitespace-only quote normalizes to "" and is a substring of every
      // segment — never let it pass as "verified evidence".
      const normalized = normalize(q)
      return normalized.length > 0 && segmentNormalized.includes(normalized)
    })

    // Stamp partner/script, segmentation, and transfer-quality metadata regardless
    // of what the model returns. The transfer analyzer sees only the bounded segment.
    const transferExperience = analyzeTransferExperience(seg)
    const stamped = {
      ...result,
      script_adherence: { ...result.script_adherence, key_evidence_quotes: verifiedQuotes },
      partner_id: PARTNER_ID,
      script_version: SCRIPT_VERSION,
      transfer_experience: transferExperience,
      transcript_segment: segmentMeta,
    }
    const hasViolation = stamped.script_adherence.violation || stamped.transfer_experience.poor_transfer

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
