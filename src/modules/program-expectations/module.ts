import type { EvalModule, ModuleResult } from "../types"
import { extractAlerts } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  ProgramExpectationsAssessmentSchema,
  type ProgramExpectationsAssessment,
} from "../../schemas/program-expectations"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import {
  finalizeCurrentAssessment,
  sha256Hex,
} from "./resolver"
import systemPrompt from "../../../prompts/program-expectations.txt"

/** Grade one transcript only; history and final alert policy remain server-owned. */
export async function assessProgramExpectationsTranscript(
  transcript: string,
  llm: LLMClient,
  purpose: "current_enrollment" | "prior_coverage",
): Promise<ProgramExpectationsAssessment> {
  const instruction = purpose === "current_enrollment"
    ? "Evaluate this enrollment call for Program Expectations coverage."
    : "Evaluate only what Program Expectations content the handling agent covered on this earlier call. Grade all eight requirements even if enrollment did not complete."

  return await llm.getStructuredResponse(
    systemPrompt,
    `${instruction}\n\n${transcript}`,
    ProgramExpectationsAssessmentSchema,
    "program_expectations_assessment",
    { temperature: 0 },
  )
}

export const programExpectationsModule: EvalModule = {
  name: MODULE_NAMES.PROGRAM_EXPECTATIONS,

  async evaluate(
    transcript: string,
    _callData: EvaluateRequest,
    llm: LLMClient,
  ): Promise<ModuleResult> {
    const start = Date.now()
    const [assessment, promptSha256] = await Promise.all([
      assessProgramExpectationsTranscript(transcript, llm, "current_enrollment"),
      sha256Hex(systemPrompt),
    ])
    const result = finalizeCurrentAssessment(assessment, promptSha256)

    return {
      module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
      result,
      has_violation: result.violation,
      violation_type: result.violation ? VIOLATION_TYPES.PROGRAM_EXPECTATIONS : null,
      processing_time_ms: Date.now() - start,
    }
  },

  extractAlerts: (result, callId, agentId, callData) =>
    extractAlerts(
      MODULE_NAMES.PROGRAM_EXPECTATIONS,
      VIOLATION_TYPES.PROGRAM_EXPECTATIONS,
      result,
      callId,
      agentId,
      callData,
    ),
}
