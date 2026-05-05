import type { EvalModule, ModuleResult, CallHistoryContext } from "../types"
import { extractAlerts, buildUserPrompt } from "../types"
import type { EvaluateRequest } from "../../schemas/requests"
import type { LLMClient } from "../../services/llm-client"
import {
  ProgramExpectationsSchema,
  type ProgramExpectationsResult,
} from "../../schemas/program-expectations"
import { MODULE_NAMES, VIOLATION_TYPES } from "../constants"
import systemPrompt from "../../../prompts/program-expectations.txt"

const PHASE_LABELS: Record<string, string> = {
  activation: "Phase 1: Activation (Months 1–3)",
  traction: "Phase 2: Traction (Months 4–9)",
  momentum: "Phase 3: Momentum (Months 10–48)",
  graduation: "Phase 4: Graduation (Months 48+)",
}

const DISCUSSION_POINT_LABELS: Record<string, string> = {
  payments_mechanics: "Discussion point: how payments work / late fees",
  payments_withheld: "Discussion point: why payments are withheld / account closures",
}

export const programExpectationsModule: EvalModule = {
  name: MODULE_NAMES.PROGRAM_EXPECTATIONS,

  async evaluate(
    transcript: string,
    callData: EvaluateRequest,
    llm: LLMClient,
    callHistory?: CallHistoryContext | null,
  ): Promise<ModuleResult> {
    const start = Date.now()

    const userPrompt = buildUserPrompt(
      "Please evaluate the following enrollment call transcript for program expectations coverage:",
      transcript,
      callHistory,
    )

    const result = await llm.getStructuredResponse(
      systemPrompt,
      userPrompt,
      ProgramExpectationsSchema,
      "program_expectations_evaluation",
    )

    // Server-side recount — don't trust LLM arithmetic or the model's
    // missing_elements list. Rebuild both from the per-element flags.
    const missing: string[] = []
    if (!result.phase_activation_covered) missing.push(PHASE_LABELS.activation)
    if (!result.phase_traction_covered) missing.push(PHASE_LABELS.traction)
    if (!result.phase_momentum_covered) missing.push(PHASE_LABELS.momentum)
    if (!result.phase_graduation_covered) missing.push(PHASE_LABELS.graduation)
    if (!result.payments_mechanics_point_covered) missing.push(DISCUSSION_POINT_LABELS.payments_mechanics)
    if (!result.payments_withheld_point_covered) missing.push(DISCUSSION_POINT_LABELS.payments_withheld)

    const actualViolation = result.enrollment_completed && missing.length > 0

    result.missing_elements = missing
    result.violation = actualViolation

    return {
      module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
      result,
      has_violation: actualViolation,
      violation_type: actualViolation ? VIOLATION_TYPES.PROGRAM_EXPECTATIONS : null,
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
