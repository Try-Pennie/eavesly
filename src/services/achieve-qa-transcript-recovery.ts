import type {
  AchieveQaTranscriptRecoverySourceEvent,
} from "../schemas/achieve-qa-transcript-recovery"
import { sha256CanonicalJson } from "./canonical-json"

/** Expected failure while reading or comparing the exact transcript-ledger cohort. */
export type AchieveQaTranscriptRecoveryLedgerFailureReason =
  | "read_unavailable"
  | "invalid_response"
  | "partial_state"
  | "conflict_state"
  | "malformed_state"

/** Closed state of the exact twelve-row transcript ledger cohort. */
export type AchieveQaTranscriptRecoveryLedgerInspection =
  | { readonly _tag: "success"; readonly state: "absent" | "identical" }
  | {
      readonly _tag: "failure"
      readonly reason: AchieveQaTranscriptRecoveryLedgerFailureReason
    }

/** Outcome of one insert-only exact-cohort restore attempt. */
export type AchieveQaTranscriptRecoveryRestore =
  | { readonly _tag: "restored" | "already_restored" }
  | {
      readonly _tag: "failure"
      readonly reason:
        | AchieveQaTranscriptRecoveryLedgerFailureReason
        | "write_unavailable"
    }

/** Exact-cohort ledger capability used by the dedicated authenticated route. */
export interface AchieveQaTranscriptRecoveryLedger {
  /** Compare all requested events with persisted transcript-ledger state. */
  inspect(
    events: ReadonlyArray<AchieveQaTranscriptRecoverySourceEvent>,
  ): Promise<AchieveQaTranscriptRecoveryLedgerInspection>
  /** Recheck and atomically insert all events, or classify an exact idempotent replay. */
  restore(
    events: ReadonlyArray<AchieveQaTranscriptRecoverySourceEvent>,
  ): Promise<AchieveQaTranscriptRecoveryRestore>
}

/** Aggregate-only, digest-bound view of one private transcript recovery source snapshot. */
export type AchieveQaTranscriptRecoverySnapshot = {
  readonly summary: {
    readonly candidate_count: 12
    readonly ready_insert_count: number
    readonly already_restored_count: number
  }
  readonly digest: {
    readonly algorithm: "SHA-256"
    readonly canonicalization: "achieve-qa-transcript-recovery-v1"
    readonly value: string
  }
}

function compareEventIds(
  left: AchieveQaTranscriptRecoverySourceEvent,
  right: AchieveQaTranscriptRecoverySourceEvent,
): number {
  return left.regal_task_id < right.regal_task_id
    ? -1
    : left.regal_task_id > right.regal_task_id
      ? 1
      : 0
}

/** Inspect and privately digest the exact twelve-event source snapshot. */
export async function inspectAchieveQaTranscriptRecovery(
  ledger: AchieveQaTranscriptRecoveryLedger,
  sourceEvents: ReadonlyArray<AchieveQaTranscriptRecoverySourceEvent>,
): Promise<
  | AchieveQaTranscriptRecoverySnapshot
  | Extract<AchieveQaTranscriptRecoveryLedgerInspection, { readonly _tag: "failure" }>
> {
  const inspection = await ledger.inspect(sourceEvents)
  if (inspection._tag === "failure") return inspection

  const digest = await sha256CanonicalJson({
    representation_version: "achieve-qa-transcript-recovery-v1",
    events: [...sourceEvents].sort(compareEventIds),
  })
  if (digest._tag === "failure") {
    return { _tag: "failure", reason: "invalid_response" }
  }

  return {
    summary: {
      candidate_count: 12,
      ready_insert_count: inspection.state === "absent" ? 12 : 0,
      already_restored_count: inspection.state === "identical" ? 12 : 0,
    },
    digest: {
      algorithm: "SHA-256",
      canonicalization: "achieve-qa-transcript-recovery-v1",
      value: digest.value,
    },
  }
}
