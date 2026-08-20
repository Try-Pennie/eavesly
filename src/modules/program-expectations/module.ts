import { z } from "zod"
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

const PriorEvidenceReferenceSchema = z.string().regex(/^(?:HA-\d{6})?$/)
const PriorProgramExpectationsModelResponseSchema = ProgramExpectationsAssessmentSchema.extend({
  enrollment_evidence_quote: PriorEvidenceReferenceSchema,
  phase_activation_evidence: PriorEvidenceReferenceSchema,
  phase_traction_evidence: PriorEvidenceReferenceSchema,
  phase_momentum_evidence: PriorEvidenceReferenceSchema,
  phase_graduation_evidence: PriorEvidenceReferenceSchema,
  credit_impact_evidence: PriorEvidenceReferenceSchema,
  payments_withheld_evidence: PriorEvidenceReferenceSchema,
  accounts_may_close_evidence: PriorEvidenceReferenceSchema,
  adjustment_period_evidence: PriorEvidenceReferenceSchema,
  key_evidence_quote: PriorEvidenceReferenceSchema,
})

const PRIOR_EVIDENCE_FIELDS = [
  { covered: "enrollment_completed", evidence: "enrollment_evidence_quote" },
  { covered: "phase_activation_covered", evidence: "phase_activation_evidence" },
  { covered: "phase_traction_covered", evidence: "phase_traction_evidence" },
  { covered: "phase_momentum_covered", evidence: "phase_momentum_evidence" },
  { covered: "phase_graduation_covered", evidence: "phase_graduation_evidence" },
  { covered: "credit_impact_downside_covered", evidence: "credit_impact_evidence" },
  { covered: "payments_withheld_downside_covered", evidence: "payments_withheld_evidence" },
  { covered: "accounts_may_close_downside_covered", evidence: "accounts_may_close_evidence" },
  { covered: "adjustment_period_downside_covered", evidence: "adjustment_period_evidence" },
] as const

type PriorEvidenceTranscript = {
  readonly promptTranscript: string
  readonly quoteByReference: ReadonlyMap<string, string>
}

function annotatePriorEvidenceTranscript(transcript: string): PriorEvidenceTranscript {
  const quoteByReference = new Map<string, string>()
  let handlingTurn = 0
  const promptTranscript = transcript.split("\n").map((line) => {
    const content = /^(?:\s*\[handling agent\]\s*:\s*)(.*)$/i.exec(line)?.[1]
    if (content === undefined || content.trim().length === 0) return line
    const reference = `HA-${String(++handlingTurn).padStart(6, "0")}`
    quoteByReference.set(reference, content)
    return `[${reference}] ${line}`
  }).join("\n")

  return { promptTranscript, quoteByReference }
}

function materializePriorEvidence(
  model: z.infer<typeof PriorProgramExpectationsModelResponseSchema>,
  quoteByReference: ReadonlyMap<string, string>,
): ProgramExpectationsAssessment {
  const evidence = Object.fromEntries(PRIOR_EVIDENCE_FIELDS.map(({ covered, evidence }) => [
    evidence,
    model[covered] ? quoteByReference.get(model[evidence]) ?? "" : "",
  ]))

  return ProgramExpectationsAssessmentSchema.parse({
    ...model,
    ...evidence,
    key_evidence_quote: quoteByReference.get(model.key_evidence_quote) ?? "",
  })
}

/** Grade one transcript only; history and final alert policy remain server-owned. */
export async function assessProgramExpectationsTranscript(
  transcript: string,
  llm: LLMClient,
  purpose: "current_enrollment" | "prior_coverage",
): Promise<ProgramExpectationsAssessment> {
  if (purpose === "current_enrollment") {
    return await llm.getStructuredResponse(
      systemPrompt,
      `Evaluate this enrollment call for Program Expectations coverage.\n\n${transcript}`,
      ProgramExpectationsAssessmentSchema,
      "program_expectations_assessment",
      { temperature: 0 },
    )
  }

  const annotated = annotatePriorEvidenceTranscript(transcript)
  const model = await llm.getStructuredResponse(
    systemPrompt,
    `Evaluate only what Program Expectations content the handling agent covered on this earlier call. Grade all eight requirements even if enrollment did not complete. The transcript labels each handling-agent turn with a stable ID such as [HA-000001]. For every true finding, return only one matching ID without brackets in its evidence field; for false findings, return an empty evidence string. Do not copy or combine transcript speech into evidence fields.\n\n${annotated.promptTranscript}`,
    PriorProgramExpectationsModelResponseSchema,
    "program_expectations_prior_assessment_v2",
    { temperature: 0 },
  )
  return materializePriorEvidence(model, annotated.quoteByReference)
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
