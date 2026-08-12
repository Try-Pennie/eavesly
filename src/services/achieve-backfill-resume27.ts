import type { AchieveBackfillCallId } from "../schemas/achieve-backfill-dry-run"
import type { AchieveBackfillResume27Request } from "../schemas/achieve-backfill-resume27"
import {
  authorizeAchieveBackfillRemaining56,
  processAchieveBackfillRemaining56Item,
  type AchieveBackfillRemaining56Approval,
  type AchieveBackfillRemaining56Context,
  type AchieveBackfillRemaining56Dependencies,
  type AchieveBackfillRemaining56ItemResult,
} from "./achieve-backfill-remaining56"

/** Stable identity for the one-time forward-only resume of ordinals after 30. */
export const ACHIEVE_BACKFILL_RESUME27_ID = "psai-245-gate-3-resume-pending-after-30-once" as const
/** Terminal ordinal that this capability must never prepare, claim, or grade. */
export const ACHIEVE_BACKFILL_RESUME27_AFTER_ORDINAL = 30 as const
/** Exact approved categorical fingerprint: 28 completed, ordinal 30 failed grading_unavailable, 27 pending, none attempted. */
export const ACHIEVE_BACKFILL_RESUME27_PROGRESS_FINGERPRINT = "ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4" as const

/** Server-owned approval for both immutable artifacts required by resume. */
export type AchieveBackfillResume27Approval = AchieveBackfillRemaining56Approval & {
  readonly approvedProgressStateFingerprint: string
}

/** Exact context independently revalidated by resume persistence RPCs. */
export type AchieveBackfillResume27Context = AchieveBackfillRemaining56Context & {
  readonly progressStateFingerprint: string
}

/** Dedicated resume dependencies; no operation accepts a reset, skip, or arbitrary ordinal. */
export interface AchieveBackfillResume27Dependencies extends Omit<
  AchieveBackfillRemaining56Dependencies,
  "initialize" | "claim"
> {
  /** Verify and durably authorize only the exact stopped production fixture. */
  initialize(context: AchieveBackfillResume27Context): Promise<
    | { readonly _tag: "ready" }
    | { readonly _tag: "rejected"; readonly reason: "state_drift" | "different_authorization" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
  /** Claim only an authorized pending progress row whose manifest ordinal is greater than 30. */
  claim(context: AchieveBackfillResume27Context, callId: AchieveBackfillCallId): Promise<
    | { readonly _tag: "claimed" }
    | { readonly _tag: "already_attempted"; readonly status: "attempted" | "completed" | "failed" }
    | { readonly _tag: "rejected" }
    | { readonly _tag: "failure"; readonly reason: "write_unavailable" | "invalid_response" }
  >
}

/** Authorization exposes only the exact 27 manifest members after terminal ordinal 30. */
export type AchieveBackfillResume27Authorization =
  | { readonly _tag: "authorized"; readonly pendingCallIds: ReadonlyArray<AchieveBackfillCallId> }
  | { readonly _tag: "rejected"; readonly reason: string }
  | { readonly _tag: "unavailable"; readonly reason: "invalid_response" }

function contextFor(command: AchieveBackfillResume27Request): AchieveBackfillResume27Context {
  return {
    callIds: command.manifest.candidates.map((candidate) => candidate.call_id),
    completedCanaryCallId: command.completed_canary.call_id,
    approvedDigest: command.digest.value,
    manifestVersion: command.manifest.representation_version,
    snapshotCutoff: command.manifest.snapshot.cutoff,
    progressStateFingerprint: command.progress_state_fingerprint.value,
  }
}

/** Require the exact approved manifest and stopped-state fingerprint before database access. */
export async function authorizeAchieveBackfillResume27(
  command: AchieveBackfillResume27Request,
  approval: AchieveBackfillResume27Approval,
): Promise<AchieveBackfillResume27Authorization> {
  const manifestAuthorization = await authorizeAchieveBackfillRemaining56(command, approval)
  if (manifestAuthorization._tag !== "authorized") return manifestAuthorization
  if (command.progress_state_fingerprint.value !== approval.approvedProgressStateFingerprint) {
    return { _tag: "rejected", reason: "progress_state_fingerprint_mismatch" }
  }

  const pendingCallIds = command.manifest.candidates
    .slice(ACHIEVE_BACKFILL_RESUME27_AFTER_ORDINAL)
    .map((candidate) => candidate.call_id)
  if (
    pendingCallIds.length !== 27
    || pendingCallIds.includes(command.completed_canary.call_id)
  ) {
    return { _tag: "rejected", reason: "resume_cohort_mismatch" }
  }
  return { _tag: "authorized", pendingCallIds }
}

/** Ask the database to verify the exact production fixture and persist forward-only authorization. */
export async function initializeAchieveBackfillResume27(
  command: AchieveBackfillResume27Request,
  dependencies: AchieveBackfillResume27Dependencies,
  approval: AchieveBackfillResume27Approval,
): Promise<
  | { readonly _tag: "ready"; readonly pendingCallIds: ReadonlyArray<AchieveBackfillCallId> }
  | Exclude<AchieveBackfillResume27Authorization, { readonly _tag: "authorized" }>
  | { readonly _tag: "rejected"; readonly reason: "state_drift" | "different_authorization" }
  | { readonly _tag: "unavailable"; readonly reason: "write_unavailable" | "invalid_response" }
> {
  const authorization = await authorizeAchieveBackfillResume27(command, approval)
  if (authorization._tag !== "authorized") return authorization

  const initialized = await dependencies.initialize(contextFor(command))
  if (initialized._tag === "failure") return { _tag: "unavailable", reason: initialized.reason }
  if (initialized._tag === "rejected") return initialized
  return { _tag: "ready", pendingCallIds: authorization.pendingCallIds }
}

/** Process one exact pending member; ordinal 30 and every earlier/outside member fail before preparation. */
export async function processAchieveBackfillResume27Item(
  command: AchieveBackfillResume27Request,
  callId: AchieveBackfillCallId,
  ordinal: number,
  dependencies: AchieveBackfillResume27Dependencies,
): Promise<AchieveBackfillRemaining56ItemResult> {
  const expected = command.manifest.candidates[ordinal - 1]?.call_id
  if (
    ordinal <= ACHIEVE_BACKFILL_RESUME27_AFTER_ORDINAL
    || ordinal > command.manifest.candidate_count
    || expected !== callId
  ) {
    throw new Error("Unauthorized PSAI-245 resume-27 item")
  }

  const resumeContext = contextFor(command)
  const legacyDependencies: AchieveBackfillRemaining56Dependencies = {
    initialize: async () => ({ _tag: "rejected", reason: "different_progress" }),
    prepare: (approvedCallId) => dependencies.prepare(approvedCallId),
    claim: (_context, approvedCallId) => dependencies.claim(resumeContext, approvedCallId),
    grade: (approvedCallId, transcript) => dependencies.grade(approvedCallId, transcript),
    finalize: (context, record) => dependencies.finalize(context, record),
    recordFailure: (context, approvedCallId, reason) => dependencies.recordFailure(
      context,
      approvedCallId,
      reason,
    ),
  }
  return processAchieveBackfillRemaining56Item(
    command,
    callId,
    ordinal,
    legacyDependencies,
  )
}
