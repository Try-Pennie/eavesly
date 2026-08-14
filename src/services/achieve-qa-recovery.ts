import { MODULE_NAMES } from "../modules/constants"
import {
  segmentWelcomeCall,
  type WelcomeCallSegment,
} from "../modules/achieve-welcome-call-qa/segment"
import type { ModuleResult } from "../modules/types"
import { EvaluateRequestSchema, type EvaluateRequest } from "../schemas/requests"
import {
  AchieveQaRecoveryDigestSchema,
  AchieveQaRecoveryCallIdSchema,
  ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT,
  type AchieveQaRecoveryCallId,
} from "../schemas/achieve-qa-recovery"
import { z } from "zod"
import type { ResolverPolicy } from "./regal-events"
import { isAchieveWelcomeCallEligibleWithSegment } from "../workflows/partner-routing"
import { sha256CanonicalJson } from "./canonical-json"

/** Parsed private transcript source reconstructed from bounded persisted recovery rows. */
export type AchieveQaRecoverySource = {
  readonly sourceKind: "legacy_qa" | "canonical_event"
  readonly transcript: string
  readonly metadata: EvaluateRequest["transcript"]["metadata"]
  readonly sfdcLeadId: string
}

/** One parsed private source candidate reconstructed by the recovery adapter. */
export type AchieveQaRecoveryCandidate = {
  readonly callId: AchieveQaRecoveryCallId
  readonly existingResult: boolean
  readonly source: AchieveQaRecoverySource | null
  readonly inputStatus?: "transcript_unavailable" | "invalid_input"
}

/** Read result used to classify one exact, privately supplied ID artifact. */
export type AchieveQaRecoveryInspection =
  | {
      readonly _tag: "success"
      readonly policy: ResolverPolicy
      readonly candidates: ReadonlyArray<AchieveQaRecoveryCandidate>
    }
  | { readonly _tag: "failure"; readonly reason: "read_unavailable" | "invalid_response" }

/** Private read-only capability used by the authenticated recovery route and Workflow. */
export interface AchieveQaRecoveryInspector {
  /** Load only the stored inputs, exact-module conflicts, and current eligibility policy for supplied IDs. */
  inspect(callIds: ReadonlyArray<AchieveQaRecoveryCallId>): Promise<AchieveQaRecoveryInspection>
}

type CandidateStatus =
  | "processable"
  | "transcript_unavailable"
  | "invalid_input"
  | "unknown_call"
  | "ineligible"
  | "segment_unavailable"
  | "existing_result"

type ManifestCandidate = {
  readonly call_id: AchieveQaRecoveryCallId
  readonly status: CandidateStatus
  readonly source_kind?: AchieveQaRecoverySource["sourceKind"]
  readonly source_digest?: string
  readonly segment_digest?: string
  readonly input_digest?: string
}

/** Aggregate, non-PII classification returned by Gate 4 dry run and rechecks. */
export type AchieveQaRecoverySummary = {
  readonly candidate_count: number
  readonly processable_count: number
  readonly transcript_available_count: number
  readonly transcript_unavailable_count: number
  readonly segment_unavailable_count: number
  readonly invalid_input_count: number
  readonly unknown_call_count: number
  readonly ineligible_count: number
  readonly existing_result_count: number
}

/** Exact private manifest plus its aggregate projection and digest. */
export type AchieveQaRecoverySnapshot = {
  /** Private processable inputs; callers must never project these into logs, responses, or durable step output. */
  readonly processableInputs: ReadonlyArray<{
    readonly callId: AchieveQaRecoveryCallId
    readonly input: EvaluateRequest
    readonly segment: WelcomeCallSegment
  }>
  readonly manifest: {
    readonly representation_version: "achieve-qa-gap-recovery-v2"
    readonly module_name: typeof MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA
    readonly candidates: ReadonlyArray<ManifestCandidate>
  }
  readonly summary: AchieveQaRecoverySummary
  readonly digest: {
    readonly algorithm: "SHA-256"
    readonly canonicalization: "achieve-qa-gap-recovery-v2"
    readonly value: string
  }
}

function compareCallIds(left: AchieveQaRecoveryCallId, right: AchieveQaRecoveryCallId): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type ClassifiedCandidate = {
  readonly manifest: ManifestCandidate
  readonly processableInput?: EvaluateRequest
  readonly processableSegment?: WelcomeCallSegment
}

async function classifyCandidate(
  callId: AchieveQaRecoveryCallId,
  candidate: AchieveQaRecoveryCandidate | undefined,
  policy: ResolverPolicy,
): Promise<ClassifiedCandidate> {
  if (candidate === undefined) {
    return { manifest: { call_id: callId, status: "unknown_call" } }
  }
  if (candidate.source === null) {
    return {
      manifest: {
        call_id: callId,
        status: candidate.existingResult
          ? "existing_result"
          : candidate.inputStatus === "invalid_input"
            ? "invalid_input"
            : "transcript_unavailable",
      },
    }
  }

  const sourceDigest = await sha256CanonicalJson(candidate.source)
  if (sourceDigest._tag === "failure") {
    return { manifest: { call_id: callId, status: "invalid_input" } }
  }
  const sourceFields = {
    source_kind: candidate.source.sourceKind,
    source_digest: sourceDigest.value,
  }
  if (candidate.existingResult) {
    return {
      manifest: { call_id: callId, status: "existing_result", ...sourceFields },
    }
  }
  const segmented = segmentWelcomeCall(candidate.source.transcript)
  const segmentDigest = await sha256CanonicalJson(segmented)
  if (segmentDigest._tag === "failure") {
    return { manifest: { call_id: callId, status: "invalid_input", ...sourceFields } }
  }
  const segmentedFields = { ...sourceFields, segment_digest: segmentDigest.value }
  if (!segmented.segment_found) {
    return {
      manifest: { call_id: callId, status: "segment_unavailable", ...segmentedFields },
    }
  }

  const input = EvaluateRequestSchema.safeParse({
    call_id: callId,
    agent_id: "",
    transcript: {
      transcript: segmented.segment,
      metadata: candidate.source.metadata,
    },
    sfdc_lead_id: candidate.source.sfdcLeadId,
  })
  if (!input.success) {
    return { manifest: { call_id: callId, status: "invalid_input", ...segmentedFields } }
  }

  const eligibility = isAchieveWelcomeCallEligibleWithSegment(input.data, policy, segmented)
  if (!eligibility.eligible) {
    return { manifest: { call_id: callId, status: "ineligible", ...segmentedFields } }
  }
  const inputDigest = await sha256CanonicalJson(input.data)
  if (inputDigest._tag === "failure") {
    return { manifest: { call_id: callId, status: "invalid_input", ...segmentedFields } }
  }
  return {
    manifest: {
      call_id: callId,
      status: "processable",
      ...segmentedFields,
      input_digest: inputDigest.value,
    },
    processableInput: input.data,
    processableSegment: segmented,
  }
}

function summarize(candidates: ReadonlyArray<ManifestCandidate>): AchieveQaRecoverySummary {
  const count = (status: CandidateStatus) => candidates.filter((candidate) => candidate.status === status).length
  return {
    candidate_count: candidates.length,
    processable_count: count("processable"),
    transcript_available_count: candidates.length - count("transcript_unavailable") - count("unknown_call"),
    transcript_unavailable_count: count("transcript_unavailable"),
    segment_unavailable_count: count("segment_unavailable"),
    invalid_input_count: count("invalid_input"),
    unknown_call_count: count("unknown_call"),
    ineligible_count: count("ineligible"),
    existing_result_count: count("existing_result"),
  }
}

/** Inspect and digest one exact ID set without exposing its private manifest. */
export async function inspectAchieveQaRecovery(
  inspector: AchieveQaRecoveryInspector,
  requestedCallIds: ReadonlyArray<AchieveQaRecoveryCallId>,
): Promise<AchieveQaRecoverySnapshot | { readonly _tag: "failure"; readonly reason: "read_unavailable" | "invalid_response" }> {
  const callIds = [...requestedCallIds].sort(compareCallIds)
  const inspected = await inspector.inspect(callIds)
  if (inspected._tag === "failure") return inspected

  const requested = new Set(callIds)
  const byId = new Map<AchieveQaRecoveryCallId, AchieveQaRecoveryCandidate>()
  for (const candidate of inspected.candidates) {
    if (!requested.has(candidate.callId) || byId.has(candidate.callId)) {
      return { _tag: "failure", reason: "invalid_response" }
    }
    byId.set(candidate.callId, candidate)
  }

  const classified = await Promise.all(
    callIds.map((callId) => classifyCandidate(callId, byId.get(callId), inspected.policy)),
  )
  const candidates = classified.map((candidate) => candidate.manifest)
  const manifest = {
    representation_version: "achieve-qa-gap-recovery-v2" as const,
    module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
    candidates,
  }
  const digest = await sha256CanonicalJson(manifest)
  if (digest._tag === "failure") return { _tag: "failure", reason: "invalid_response" }

  const processableInputs = classified.flatMap((candidate, index) => {
    const callId = callIds[index]
    return candidate.processableInput === undefined
      || candidate.processableSegment === undefined
      || callId === undefined
      ? []
      : [{
          callId,
          input: candidate.processableInput,
          segment: candidate.processableSegment,
        }]
  })

  return {
    processableInputs,
    manifest,
    summary: summarize(candidates),
    digest: {
      algorithm: "SHA-256",
      canonicalization: "achieve-qa-gap-recovery-v2",
      value: digest.value,
    },
  }
}

/** Runtime-hop payload accepted only by the dedicated Gate 4 Workflow. */
export const AchieveQaRecoveryWorkflowCommandSchema = z.object({
  call_ids: z.array(AchieveQaRecoveryCallIdSchema).length(ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT),
  digest: AchieveQaRecoveryDigestSchema,
}).strict().superRefine((command, context) => {
  if (new Set(command.call_ids).size !== command.call_ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate call IDs" })
  }
  if (command.call_ids.some((callId, index) => index > 0 && command.call_ids[index - 1] >= callId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Call IDs must be sorted" })
  }
})

/** Parsed private command carried into the dedicated recovery Workflow. */
export type AchieveQaRecoveryWorkflowCommand = z.infer<typeof AchieveQaRecoveryWorkflowCommandSchema>

/** Private bounded grading input plus its approved full-source-relative segment metadata. */
export type AchieveQaRecoveryGradeCandidate = {
  readonly input: EvaluateRequest
  readonly segment: WelcomeCallSegment
}

/** Insert-only, no-alert capabilities used by the dedicated recovery execution. */
export interface AchieveQaRecoveryExecutionDependencies extends AchieveQaRecoveryInspector {
  /** Recheck exact-module absence immediately before one grading attempt. */
  hasExistingResult(callId: AchieveQaRecoveryCallId): Promise<
    | { readonly _tag: "success"; readonly exists: boolean }
    | { readonly _tag: "failure"; readonly reason: "read_unavailable" | "invalid_response" }
  >
  /** Grade one already bounded input with its approved precomputed segment exactly once. */
  grade(candidate: AchieveQaRecoveryGradeCandidate): Promise<
    | { readonly _tag: "success"; readonly result: ModuleResult }
    | { readonly _tag: "failure"; readonly reason: "grading_unavailable" | "invalid_response" }
  >
  /** Atomically insert an ordinary result without alerts, metadata, upsert, or audit-only provenance. */
  finalize(callId: AchieveQaRecoveryCallId, result: ModuleResult): Promise<
    | { readonly _tag: "inserted" | "already_exists" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
}

/** Aggregate-only Workflow result; no IDs, transcripts, result content, alerts, or customer metadata. */
export type AchieveQaRecoveryExecutionResult = AchieveQaRecoverySummary & {
  readonly status: "completed" | "stopped" | "rejected"
  readonly completed_count: number
  readonly reason?:
    | "server_approval_missing"
    | "snapshot_digest_mismatch"
    | "read_unavailable"
    | "invalid_response"
    | "existing_result_detected"
    | "grading_unavailable"
    | "write_unavailable"
}

function executionResult(
  snapshot: AchieveQaRecoverySnapshot,
  status: AchieveQaRecoveryExecutionResult["status"],
  completedCount: number,
  reason?: AchieveQaRecoveryExecutionResult["reason"],
): AchieveQaRecoveryExecutionResult {
  return {
    status,
    ...(reason === undefined ? {} : { reason }),
    ...snapshot.summary,
    completed_count: completedCount,
  }
}

/** Recheck the exact approved snapshot, then grade and insert each processable input once, sequentially. */
export async function runApprovedAchieveQaRecovery(
  payload: unknown,
  dependencies: AchieveQaRecoveryExecutionDependencies,
  serverApprovedDigest: string | undefined,
): Promise<AchieveQaRecoveryExecutionResult> {
  const command = AchieveQaRecoveryWorkflowCommandSchema.safeParse(payload)
  if (!command.success) {
    return {
      status: "rejected",
      reason: "invalid_response",
      candidate_count: ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT,
      processable_count: 0,
      transcript_available_count: 0,
      transcript_unavailable_count: 0,
      segment_unavailable_count: 0,
      invalid_input_count: 0,
      unknown_call_count: 0,
      ineligible_count: 0,
      existing_result_count: 0,
      completed_count: 0,
    }
  }

  if (serverApprovedDigest === undefined || command.data.digest.value !== serverApprovedDigest) {
    return {
      status: "rejected",
      reason: "server_approval_missing",
      candidate_count: ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT,
      processable_count: 0,
      transcript_available_count: 0,
      transcript_unavailable_count: 0,
      segment_unavailable_count: 0,
      invalid_input_count: 0,
      unknown_call_count: 0,
      ineligible_count: 0,
      existing_result_count: 0,
      completed_count: 0,
    }
  }

  const snapshot = await inspectAchieveQaRecovery(dependencies, command.data.call_ids)
  if ("_tag" in snapshot) {
    return {
      status: "stopped",
      reason: snapshot.reason,
      candidate_count: ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT,
      processable_count: 0,
      transcript_available_count: 0,
      transcript_unavailable_count: 0,
      segment_unavailable_count: 0,
      invalid_input_count: 0,
      unknown_call_count: 0,
      ineligible_count: 0,
      existing_result_count: 0,
      completed_count: 0,
    }
  }
  if (snapshot.digest.value !== command.data.digest.value) {
    return executionResult(snapshot, "rejected", 0, "snapshot_digest_mismatch")
  }

  let completedCount = 0
  for (const candidate of snapshot.processableInputs) {
    const recheck = await dependencies.hasExistingResult(candidate.callId)
    if (recheck._tag === "failure") {
      return executionResult(snapshot, "stopped", completedCount, recheck.reason)
    }
    if (recheck.exists) {
      return executionResult(snapshot, "stopped", completedCount, "existing_result_detected")
    }

    const graded = await dependencies.grade({
      input: candidate.input,
      segment: candidate.segment,
    })
    if (graded._tag === "failure") {
      return executionResult(snapshot, "stopped", completedCount, graded.reason)
    }
    if (
      graded.result.module_name !== MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA
      || typeof graded.result.result !== "object"
      || graded.result.result === null
      || Array.isArray(graded.result.result)
      || ("grading_skipped" in graded.result.result
        && graded.result.result.grading_skipped === true)
    ) {
      return executionResult(snapshot, "stopped", completedCount, "invalid_response")
    }

    const finalized = await dependencies.finalize(candidate.callId, graded.result)
    if (finalized._tag === "failure") {
      return executionResult(snapshot, "stopped", completedCount, finalized.reason)
    }
    if (finalized._tag === "already_exists") {
      return executionResult(snapshot, "stopped", completedCount, "existing_result_detected")
    }
    completedCount += 1
  }

  return executionResult(snapshot, "completed", completedCount)
}
