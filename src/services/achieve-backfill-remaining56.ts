import type { ModuleResult } from "../modules/types"
import type { AchieveBackfillRemaining56Request } from "../schemas/achieve-backfill-remaining56"
import type { AchieveBackfillCallId } from "../schemas/achieve-backfill-dry-run"
import { authorizeAchieveBackfillCanary } from "./achieve-backfill-canary"

/** Stable identity for the separately gated one-time remaining-56 capability. */
export const ACHIEVE_BACKFILL_REMAINING56_ID = "psai-245-gate-3-remaining-56-once" as const
/** Provenance batch identity for the 56 rows; distinct from the completed canary. */
export const ACHIEVE_BACKFILL_REMAINING56_BATCH_ID = "psai-245-gate-3-approved-remaining-56" as const

/** Server-owned exact-digest approval for the separately gated capability. */
export type AchieveBackfillRemaining56Approval = { readonly approvedDigest: string }

/** Context checked by every durable progress RPC. */
export type AchieveBackfillRemaining56Context = {
  readonly callIds: ReadonlyArray<AchieveBackfillCallId>
  readonly completedCanaryCallId: AchieveBackfillCallId
  readonly approvedDigest: string
  readonly manifestVersion: string
  readonly snapshotCutoff: string
}

/** Insert-only, metadata-free result passed to atomic finalization. */
export type AchieveBackfillRemaining56Insert = {
  readonly callId: AchieveBackfillCallId
  readonly moduleResult: ModuleResult
  readonly alertSent: false
}

/** Categorical failure persisted for an item whose one grading attempt was claimed. */
export type AchieveBackfillRemaining56Failure =
  | "transcript_unavailable"
  | "segment_unavailable"
  | AchieveBackfillRemaining56PostClaimFailure
  | "failure_persistence_unknown"

/** Failures that can occur only after the irreversible grading claim. */
export type AchieveBackfillRemaining56PostClaimFailure =
  | "grading_unavailable"
  | "invalid_response"
  | "write_unavailable"

/** Narrow durable and private boundaries used by the remaining-56 orchestration. */
export interface AchieveBackfillRemaining56Dependencies {
  /** Verify the canary and initialize exactly 56 pending progress rows atomically. */
  initialize(context: AchieveBackfillRemaining56Context): Promise<
    | { readonly _tag: "ready" }
    | { readonly _tag: "rejected"; readonly reason: "completed_canary_missing" | "cohort_conflict" | "different_progress" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
  /** Privately load and verify a gradeable bounded segment before claiming an attempt. */
  prepare(callId: AchieveBackfillCallId): Promise<
    | { readonly _tag: "ready"; readonly transcript: string }
    | { readonly _tag: "failure"; readonly reason: "transcript_unavailable" | "segment_unavailable" | "invalid_response" }
  >
  /** Persist the irreversible attempted state immediately before the LLM call. */
  claim(context: AchieveBackfillRemaining56Context, callId: AchieveBackfillCallId): Promise<
    | { readonly _tag: "claimed" }
    | { readonly _tag: "already_attempted"; readonly status: "attempted" | "completed" | "failed" }
    | { readonly _tag: "rejected" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
  /** Execute the production Achieve grader once for a durably claimed item. */
  grade(callId: AchieveBackfillCallId, transcript: string): Promise<
    | { readonly _tag: "success"; readonly result: ModuleResult }
    | { readonly _tag: "failure"; readonly reason: "grading_unavailable" | "invalid_response" }
  >
  /** Plain-insert one immutable result and mark progress completed in one transaction. */
  finalize(context: AchieveBackfillRemaining56Context, record: AchieveBackfillRemaining56Insert): Promise<
    | { readonly _tag: "inserted" | "already_completed" }
    | { readonly _tag: "rejected" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
  /** Categorize a claimed item failure; this transition never makes it retryable. */
  recordFailure(
    context: AchieveBackfillRemaining56Context,
    callId: AchieveBackfillCallId,
    reason: AchieveBackfillRemaining56PostClaimFailure,
  ): Promise<{ readonly _tag: "recorded" | "already_recorded" } | { readonly _tag: "failure" }>
}

/** Authorization result exposing IDs only to private Workflow orchestration. */
export type AchieveBackfillRemaining56Authorization =
  | { readonly _tag: "authorized"; readonly remainingCallIds: ReadonlyArray<AchieveBackfillCallId> }
  | { readonly _tag: "rejected"; readonly reason: string }
  | { readonly _tag: "unavailable"; readonly reason: "invalid_response" }

function contextFor(command: AchieveBackfillRemaining56Request): AchieveBackfillRemaining56Context {
  return {
    callIds: command.manifest.candidates.map((candidate) => candidate.call_id),
    completedCanaryCallId: command.completed_canary.call_id,
    approvedDigest: command.digest.value,
    manifestVersion: command.manifest.representation_version,
    snapshotCutoff: command.manifest.snapshot.cutoff,
  }
}

/** Verify exact manifest digest, ordering, and completed-canary provenance before any write. */
export async function authorizeAchieveBackfillRemaining56(
  command: AchieveBackfillRemaining56Request,
  approval: AchieveBackfillRemaining56Approval,
): Promise<AchieveBackfillRemaining56Authorization> {
  const canaryAuthorization = await authorizeAchieveBackfillCanary({
    manifest: command.manifest,
    digest: command.digest,
    canary_call_id: command.completed_canary.call_id,
  }, approval)
  if (canaryAuthorization !== undefined) {
    if (canaryAuthorization._tag === "unavailable") {
      return { _tag: "unavailable", reason: "invalid_response" }
    }
    return canaryAuthorization
  }

  if (
    command.completed_canary.audit_only !== true
    || command.completed_canary.approved_digest !== command.digest.value
    || command.completed_canary.manifest_version !== command.manifest.representation_version
    || command.completed_canary.snapshot_cutoff !== command.manifest.snapshot.cutoff
  ) {
    return { _tag: "rejected", reason: "completed_canary_provenance_mismatch" }
  }

  const remainingCallIds = command.manifest.candidates
    .map((candidate) => candidate.call_id)
    .filter((callId) => callId !== command.completed_canary.call_id)
  if (remainingCallIds.length !== 56) {
    return { _tag: "rejected", reason: "completed_canary_provenance_mismatch" }
  }
  return { _tag: "authorized", remainingCallIds }
}

/** Atomically verify the completed canary and create/replay exactly 56 progress rows. */
export async function initializeAchieveBackfillRemaining56(
  command: AchieveBackfillRemaining56Request,
  dependencies: AchieveBackfillRemaining56Dependencies,
  approval: AchieveBackfillRemaining56Approval,
): Promise<
  | { readonly _tag: "ready"; readonly remainingCallIds: ReadonlyArray<AchieveBackfillCallId> }
  | Exclude<AchieveBackfillRemaining56Authorization, { readonly _tag: "authorized" }>
  | { readonly _tag: "rejected"; readonly reason: "completed_canary_missing" | "cohort_conflict" | "different_progress" }
  | { readonly _tag: "unavailable"; readonly reason: "write_unavailable" | "invalid_response" }
> {
  const authorization = await authorizeAchieveBackfillRemaining56(command, approval)
  if (authorization._tag !== "authorized") return authorization

  const initialized = await dependencies.initialize(contextFor(command))
  if (initialized._tag === "failure") return { _tag: "unavailable", reason: initialized.reason }
  if (initialized._tag === "rejected") return initialized
  return { _tag: "ready", remainingCallIds: authorization.remainingCallIds }
}

/** Categorical, ordinal-only durable outcome for one authorized item. */
export type AchieveBackfillRemaining56ItemResult =
  | { readonly _tag: "completed"; readonly ordinal: number }
  | { readonly _tag: "stopped"; readonly ordinal: number; readonly reason: AchieveBackfillRemaining56Failure | "attempted" | "failed" }
  | { readonly _tag: "stopped_unknown"; readonly ordinal: number; readonly reason: "failure_persistence_unknown" }

async function failClaimedItem(
  context: AchieveBackfillRemaining56Context,
  callId: AchieveBackfillCallId,
  ordinal: number,
  reason: AchieveBackfillRemaining56PostClaimFailure,
  dependencies: AchieveBackfillRemaining56Dependencies,
): Promise<AchieveBackfillRemaining56ItemResult> {
  const persisted = await dependencies.recordFailure(context, callId, reason)
  if (persisted._tag === "failure") {
    return { _tag: "stopped_unknown", ordinal, reason: "failure_persistence_unknown" }
  }
  return { _tag: "stopped", ordinal, reason }
}

/** Process one authorized item; private readiness precedes the claim, which immediately precedes the LLM. */
export async function processAchieveBackfillRemaining56Item(
  command: AchieveBackfillRemaining56Request,
  callId: AchieveBackfillCallId,
  ordinal: number,
  dependencies: AchieveBackfillRemaining56Dependencies,
): Promise<AchieveBackfillRemaining56ItemResult> {
  const context = contextFor(command)
  const manifestOrdinal = context.callIds.indexOf(callId) + 1
  if (
    manifestOrdinal !== ordinal
    || callId === context.completedCanaryCallId
    || !context.callIds.includes(callId)
  ) {
    throw new Error("Unauthorized PSAI-245 remaining-56 item")
  }

  const prepared = await dependencies.prepare(callId)
  if (prepared._tag === "failure") {
    return { _tag: "stopped", ordinal, reason: prepared.reason }
  }

  // This is deliberately the last operation before the one-shot LLM send.
  const claim = await dependencies.claim(context, callId)
  if (claim._tag === "already_attempted") {
    if (claim.status === "completed") return { _tag: "completed", ordinal }
    return { _tag: "stopped", ordinal, reason: claim.status }
  }
  if (claim._tag === "failure") {
    return { _tag: "stopped_unknown", ordinal, reason: "failure_persistence_unknown" }
  }
  if (claim._tag === "rejected") {
    return { _tag: "stopped", ordinal, reason: "invalid_response" }
  }

  const graded = await dependencies.grade(callId, prepared.transcript)
  if (graded._tag === "failure") {
    return failClaimedItem(context, callId, ordinal, graded.reason, dependencies)
  }
  if (
    graded.result.module_name !== command.manifest.module_name
    || typeof graded.result.result !== "object"
    || graded.result.result === null
    || Array.isArray(graded.result.result)
  ) {
    return failClaimedItem(context, callId, ordinal, "invalid_response", dependencies)
  }

  const finalized = await dependencies.finalize(context, {
    callId,
    moduleResult: {
      ...graded.result,
      result: {
        ...graded.result.result,
        backfill: {
          audit_only: true,
          approved_digest: command.digest.value,
          batch_id: ACHIEVE_BACKFILL_REMAINING56_BATCH_ID,
          capability_id: ACHIEVE_BACKFILL_REMAINING56_ID,
          completed_canary_call_id: command.completed_canary.call_id,
          manifest_version: command.manifest.representation_version,
          snapshot_cutoff: command.manifest.snapshot.cutoff,
        },
      },
    },
    alertSent: false,
  })
  if (finalized._tag === "inserted" || finalized._tag === "already_completed") {
    return { _tag: "completed", ordinal }
  }
  return failClaimedItem(
    context,
    callId,
    ordinal,
    finalized._tag === "failure" ? finalized.reason : "invalid_response",
    dependencies,
  )
}
