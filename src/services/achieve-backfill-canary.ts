import type { ModuleResult } from "../modules/types"
import type {
  AchieveBackfillCanaryRequest,
} from "../schemas/achieve-backfill-canary"
import {
  ACHIEVE_BACKFILL_MANIFEST_VERSION,
} from "../schemas/achieve-backfill-canary"
import type { AchieveBackfillCallId } from "../schemas/achieve-backfill-dry-run"
import { sha256CanonicalJson } from "./canonical-json"

/** Exact Gate 1 digest Noah approved for the bounded PSAI-245 Gate 2 canary. */
export const ACHIEVE_BACKFILL_APPROVED_DIGEST = "01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e" as const

const BATCH_ID = "psai-245-gate-2-approved-manifest" as const
/** Stable identity shared by route deduplication, persistence, and operations. */
export const ACHIEVE_BACKFILL_CANARY_ID = "psai-245-gate-2-one-call-canary" as const

/** Safe categorical provenance projected from an existing audit-only result. */
export type AchieveBackfillAuditProvenance = {
  readonly auditOnly: boolean
  readonly approvedDigest: string | null
  readonly batchId: string | null
  readonly canaryId: string | null
  readonly canaryCallId: AchieveBackfillCallId | null
  readonly manifestVersion: string | null
  readonly snapshotCutoff: string | null
}

/** One existing exact-module row projected without grading result content. */
export type AchieveBackfillExistingResult = {
  readonly callId: AchieveBackfillCallId
  readonly provenance: AchieveBackfillAuditProvenance
}

/** Result of the immediate 57-candidate pre-action recheck. */
export type AchieveBackfillCanaryInspection =
  | {
      readonly _tag: "success"
      readonly knownCallIds: ReadonlyArray<AchieveBackfillCallId>
      readonly existingResults: ReadonlyArray<AchieveBackfillExistingResult>
    }
  | { readonly _tag: "failure"; readonly reason: "read_unavailable" | "invalid_response" }

/** Insert-only record accepted by the Gate 2 persistence boundary. */
export type AchieveBackfillCanaryInsert = {
  readonly callId: AchieveBackfillCallId
  readonly moduleResult: ModuleResult
  readonly alertSent: false
}

/** Narrow capabilities needed by the one-call canary use case. */
export interface AchieveBackfillCanaryDependencies {
  /** Recheck all 57 call IDs and exact-module result provenance. */
  inspect(callIds: ReadonlyArray<AchieveBackfillCallId>): Promise<AchieveBackfillCanaryInspection>
  /** Privately load the selected historical transcript without projecting it outward. */
  loadTranscript(callId: AchieveBackfillCallId): Promise<
    | { readonly _tag: "success"; readonly transcript: string }
    | { readonly _tag: "failure"; readonly reason: "transcript_unavailable" | "invalid_response" }
  >
  /** Run the production Achieve QA grading path for the selected call only. */
  grade(callId: AchieveBackfillCallId, transcript: string): Promise<
    | { readonly _tag: "success"; readonly result: ModuleResult }
    | { readonly _tag: "failure"; readonly reason: "grading_unavailable" | "invalid_response" }
  >
  /** Atomically final-recheck all 57 IDs and plain-insert one immutable audit result. */
  finalize(
    callIds: ReadonlyArray<AchieveBackfillCallId>,
    record: AchieveBackfillCanaryInsert,
  ): Promise<
    | { readonly _tag: "inserted" }
    | { readonly _tag: "already_completed" }
    | {
        readonly _tag: "rejected"
        readonly reason: "unknown_call_ids" | "ordinary_results_exist" | "different_audit_provenance" | "canary_already_used"
      }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
}

/** Server-owned exact digest approval policy. */
export type AchieveBackfillCanaryApproval = {
  readonly approvedDigest: string
}

/** Categorical, ID-only result of one Gate 2 command. */
export type AchieveBackfillCanaryResult =
  | { readonly _tag: "completed"; readonly callId: AchieveBackfillCallId; readonly approvedDigest: string }
  | { readonly _tag: "already_completed"; readonly callId: AchieveBackfillCallId; readonly approvedDigest: string }
  | {
      readonly _tag: "rejected"
      readonly reason:
        | "unapproved_digest"
        | "manifest_digest_mismatch"
        | "duplicate_call_ids"
        | "unsorted_call_ids"
        | "canary_not_in_manifest"
        | "unknown_call_ids"
        | "ordinary_results_exist"
        | "different_audit_provenance"
      readonly callIds: ReadonlyArray<AchieveBackfillCallId>
    }
  | {
      readonly _tag: "unavailable"
      readonly reason: "read_unavailable" | "invalid_response" | "transcript_unavailable" | "grading_unavailable" | "write_unavailable"
    }

function compareCallIds(left: AchieveBackfillCallId, right: AchieveBackfillCallId): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactProvenance(
  row: AchieveBackfillExistingResult,
  command: AchieveBackfillCanaryRequest,
): boolean {
  const provenance = row.provenance
  return row.callId === command.canary_call_id
    && provenance.auditOnly === true
    && provenance.approvedDigest === command.digest.value
    && provenance.batchId === BATCH_ID
    && provenance.canaryId === ACHIEVE_BACKFILL_CANARY_ID
    && provenance.canaryCallId === command.canary_call_id
    && provenance.manifestVersion === ACHIEVE_BACKFILL_MANIFEST_VERSION
    && provenance.snapshotCutoff === command.manifest.snapshot.cutoff
}

function classifyInspection(
  inspection: Extract<AchieveBackfillCanaryInspection, { readonly _tag: "success" }>,
  callIds: ReadonlyArray<AchieveBackfillCallId>,
  command: AchieveBackfillCanaryRequest,
): AchieveBackfillCanaryResult | undefined {
  const requested = new Set(callIds)
  if (
    inspection.knownCallIds.some((callId) => !requested.has(callId))
    || inspection.existingResults.some((row) => !requested.has(row.callId))
  ) {
    return { _tag: "unavailable", reason: "invalid_response" }
  }

  const known = new Set(inspection.knownCallIds)
  const unknown = callIds.filter((callId) => !known.has(callId))
  if (unknown.length > 0) {
    return { _tag: "rejected", reason: "unknown_call_ids", callIds: unknown }
  }

  const ordinary = inspection.existingResults
    .filter((row) => row.provenance.auditOnly !== true)
    .map((row) => row.callId)
    .sort(compareCallIds)
  if (ordinary.length > 0) {
    return { _tag: "rejected", reason: "ordinary_results_exist", callIds: ordinary }
  }

  const differentAudit = inspection.existingResults
    .filter((row) => !exactProvenance(row, command))
    .map((row) => row.callId)
    .sort(compareCallIds)
  if (differentAudit.length > 0) {
    return { _tag: "rejected", reason: "different_audit_provenance", callIds: differentAudit }
  }

  if (inspection.existingResults.some((row) => row.callId === command.canary_call_id)) {
    return {
      _tag: "already_completed",
      callId: command.canary_call_id,
      approvedDigest: command.digest.value,
    }
  }

  return undefined
}

function duplicateIds(callIds: ReadonlyArray<AchieveBackfillCallId>): ReadonlyArray<AchieveBackfillCallId> {
  const seen = new Set<AchieveBackfillCallId>()
  const duplicate = new Set<AchieveBackfillCallId>()
  for (const callId of callIds) {
    if (seen.has(callId)) duplicate.add(callId)
    seen.add(callId)
  }
  return [...duplicate].sort(compareCallIds)
}

type AchieveBackfillCanaryAuthorizationFailure = Extract<
  AchieveBackfillCanaryResult,
  { readonly _tag: "rejected" | "unavailable" }
>

/**
 * Verify the exact approved digest, canonical manifest, ordering, and membership.
 * Returns undefined only when the command is safe to enqueue.
 */
export async function authorizeAchieveBackfillCanary(
  command: AchieveBackfillCanaryRequest,
  approval: AchieveBackfillCanaryApproval,
): Promise<AchieveBackfillCanaryAuthorizationFailure | undefined> {
  if (command.digest.value !== approval.approvedDigest) {
    return { _tag: "rejected", reason: "unapproved_digest", callIds: [] }
  }

  const calculated = await sha256CanonicalJson(command.manifest)
  if (calculated._tag === "failure") {
    return { _tag: "unavailable", reason: "invalid_response" }
  }
  if (calculated.value !== command.digest.value) {
    return { _tag: "rejected", reason: "manifest_digest_mismatch", callIds: [] }
  }

  const callIds = command.manifest.candidates.map((candidate) => candidate.call_id)
  const duplicates = duplicateIds(callIds)
  if (duplicates.length > 0) {
    return { _tag: "rejected", reason: "duplicate_call_ids", callIds: duplicates }
  }
  if (callIds.some((callId, index) => index > 0 && compareCallIds(callIds[index - 1], callId) >= 0)) {
    return { _tag: "rejected", reason: "unsorted_call_ids", callIds: [] }
  }
  if (!callIds.includes(command.canary_call_id)) {
    return { _tag: "rejected", reason: "canary_not_in_manifest", callIds: [command.canary_call_id] }
  }

  return undefined
}

/**
 * Authorize, immediately recheck, grade, and atomically finalize one canary.
 * The dedicated Workflow durably owns the grading step in production.
 */
export async function runAchieveBackfillCanary(
  command: AchieveBackfillCanaryRequest,
  dependencies: AchieveBackfillCanaryDependencies,
  approval: AchieveBackfillCanaryApproval,
): Promise<AchieveBackfillCanaryResult> {
  const authorization = await authorizeAchieveBackfillCanary(command, approval)
  if (authorization !== undefined) return authorization

  const callIds = command.manifest.candidates.map((candidate) => candidate.call_id)
  const inspection = await dependencies.inspect(callIds)
  if (inspection._tag === "failure") {
    return { _tag: "unavailable", reason: inspection.reason }
  }
  const blocked = classifyInspection(inspection, callIds, command)
  if (blocked !== undefined) return blocked

  const transcript = await dependencies.loadTranscript(command.canary_call_id)
  if (transcript._tag === "failure") {
    return { _tag: "unavailable", reason: transcript.reason }
  }
  const graded = await dependencies.grade(command.canary_call_id, transcript.transcript)
  if (graded._tag === "failure") {
    return { _tag: "unavailable", reason: graded.reason }
  }
  if (graded.result.module_name !== command.manifest.module_name) {
    return { _tag: "unavailable", reason: "invalid_response" }
  }
  if (typeof graded.result.result !== "object" || graded.result.result === null || Array.isArray(graded.result.result)) {
    return { _tag: "unavailable", reason: "invalid_response" }
  }

  const inserted = await dependencies.finalize(callIds, {
    callId: command.canary_call_id,
    moduleResult: {
      ...graded.result,
      result: {
        ...graded.result.result,
        backfill: {
          audit_only: true,
          approved_digest: command.digest.value,
          batch_id: BATCH_ID,
          canary_id: ACHIEVE_BACKFILL_CANARY_ID,
          canary_call_id: command.canary_call_id,
          manifest_version: command.manifest.representation_version,
          snapshot_cutoff: command.manifest.snapshot.cutoff,
        },
      },
    },
    alertSent: false,
  })
  if (inserted._tag === "failure") {
    return { _tag: "unavailable", reason: inserted.reason }
  }
  if (inserted._tag === "rejected") {
    return {
      _tag: "rejected",
      reason: inserted.reason === "canary_already_used"
        ? "different_audit_provenance"
        : inserted.reason,
      callIds: [],
    }
  }
  if (inserted._tag === "already_completed") {
    return {
      _tag: "already_completed",
      callId: command.canary_call_id,
      approvedDigest: command.digest.value,
    }
  }

  return {
    _tag: "completed",
    callId: command.canary_call_id,
    approvedDigest: command.digest.value,
  }
}
