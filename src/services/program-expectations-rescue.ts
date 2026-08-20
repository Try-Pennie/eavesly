import { MODULE_NAMES, VIOLATION_TYPES } from "../modules/constants"
import { assessProgramExpectationsTranscript } from "../modules/program-expectations/module"
import {
  PROGRAM_EXPECTATIONS_MAX_PRIOR_EVALUATIONS,
  resolvePriorAssessments,
  sha256Hex,
  validatePriorAssessment,
} from "../modules/program-expectations/resolver"
import type { ModuleResult } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import {
  ProgramExpectationsSchema,
  type PriorProgramExpectationAssessment,
} from "../schemas/program-expectations"
import type { Bindings } from "../types/env"
import systemPrompt from "../../prompts/program-expectations.txt"
import { createLLMClient } from "./llm-client"
import { modelForModule } from "./model-selection"
import { ProgramExpectationsHistoryService } from "./program-expectations-history"

/** Resolve one current-call PE alert candidate against verified prior transcripts. */
export async function resolveProgramExpectationsCandidate(
  env: Bindings,
  callData: EvaluateRequest,
  currentResult: ModuleResult,
): Promise<ModuleResult> {
  const started = Date.now()
  const current = ProgramExpectationsSchema.parse(currentResult.result)
  if (current.decision.status !== "alert_missing") return currentResult

  const history = new ProgramExpectationsHistoryService(env)
  const lookup = await history.lookup({
    currentCallId: callData.call_id,
    expectedLeadId: callData.sfdc_lead_id,
    expectedStartedAt: callData.transcript.metadata.timestamp,
  })

  if (lookup.status !== "ready") {
    const result = resolvePriorAssessments(current, lookup, [])
    return toModuleResult(result, currentResult.processing_time_ms + Date.now() - started)
  }

  const model = modelForModule(env, MODULE_NAMES.PROGRAM_EXPECTATIONS) ?? env.OPENROUTER_MODEL
  const llm = createLLMClient(env, model, { invalidResponseLogging: "categorical_only" })
  const promptSha256 = await sha256Hex(systemPrompt)
  const assessments: PriorProgramExpectationAssessment[] = []

  for (const call of lookup.calls.slice(0, PROGRAM_EXPECTATIONS_MAX_PRIOR_EVALUATIONS)) {
    const cached = await history.loadCachedAssessment(call, promptSha256, model)
    const assessment = cached ?? await assessProgramExpectationsTranscript(
      call.transcript,
      llm,
      "prior_coverage",
    )
    if (cached === null) {
      await history.storeAssessment({
        call,
        leadId: lookup.lead_id,
        assessment,
        promptSha256,
        model,
      })
    }
    assessments.push(await validatePriorAssessment(call, assessment, callData.agent_email))
  }

  const result = resolvePriorAssessments(current, lookup, assessments)
  return toModuleResult(result, currentResult.processing_time_ms + Date.now() - started)
}

/** Convert a failed prior-resolution dependency into a muted review decision. */
export function holdProgramExpectationsCandidateForReview(
  currentResult: ModuleResult,
): ModuleResult {
  const current = ProgramExpectationsSchema.parse(currentResult.result)
  const result = resolvePriorAssessments(
    current,
    { status: "needs_review", reason: "dependency_failure" },
    [],
  )
  return toModuleResult(result, currentResult.processing_time_ms)
}

function toModuleResult(
  result: ReturnType<typeof ProgramExpectationsSchema.parse>,
  processingTimeMs: number,
): ModuleResult {
  return {
    module_name: MODULE_NAMES.PROGRAM_EXPECTATIONS,
    result,
    has_violation: result.violation,
    violation_type: result.violation ? VIOLATION_TYPES.PROGRAM_EXPECTATIONS : null,
    processing_time_ms: processingTimeMs,
  }
}
