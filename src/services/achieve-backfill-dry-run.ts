import { MODULE_NAMES } from "../modules/constants"
import {
  ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF,
  type AchieveBackfillCallId,
} from "../schemas/achieve-backfill-dry-run"
import { sha256CanonicalJson } from "./canonical-json"

const REPRESENTATION_VERSION = "psai-245-achieve-backfill-manifest-v1" as const
const CANONICALIZATION_VERSION = "eavesly-canonical-json-v1" as const

/** Read-only outcome for validating privately supplied Achieve call IDs. */
export type AchieveBackfillInspectionResult =
  | {
      readonly _tag: "success"
      readonly knownCallIds: ReadonlyArray<AchieveBackfillCallId>
      readonly ordinaryResultCallIds: ReadonlyArray<AchieveBackfillCallId>
    }
  | {
      readonly _tag: "failure"
      readonly reason: "read_unavailable" | "invalid_response"
    }

/** Narrow read capability used by PSAI-245 Gate 1. It exposes no write operation. */
export interface AchieveBackfillInspector {
  /** Check call existence and ordinary Achieve result conflicts using ID-only projections. */
  inspect(callIds: ReadonlyArray<AchieveBackfillCallId>): Promise<AchieveBackfillInspectionResult>
}

type Manifest = {
  readonly representation_version: typeof REPRESENTATION_VERSION
  readonly gate: "gate_1_dry_run"
  readonly module_name: typeof MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA
  readonly snapshot: {
    readonly cutoff: typeof ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF
    readonly funnel_counts: readonly [378, 101, 89, 88, 65, 57]
  }
  readonly candidate_count: 57
  readonly candidates: ReadonlyArray<{
    readonly call_id: AchieveBackfillCallId
    readonly reason: "approved_frozen_cohort"
    readonly status: "eligible"
  }>
}

/** Typed outcome from the no-write Gate 1 use case. */
export type AchieveBackfillDryRunResult =
  | {
      readonly _tag: "ready"
      readonly manifest: Manifest
      readonly digest: {
        readonly algorithm: "SHA-256"
        readonly canonicalization: typeof CANONICALIZATION_VERSION
        readonly value: string
      }
    }
  | {
      readonly _tag: "rejected"
      readonly reason: "invalid_candidate_count" | "duplicate_call_ids" | "unknown_call_ids" | "ordinary_results_exist"
      readonly callIds: ReadonlyArray<AchieveBackfillCallId>
    }
  | {
      readonly _tag: "unavailable"
      readonly reason: "read_unavailable" | "invalid_response"
    }

function compareCallIds(left: AchieveBackfillCallId, right: AchieveBackfillCallId): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortedUnique(callIds: ReadonlyArray<AchieveBackfillCallId>): ReadonlyArray<AchieveBackfillCallId> {
  return [...new Set(callIds)].sort(compareCallIds)
}

function duplicateIds(callIds: ReadonlyArray<AchieveBackfillCallId>): ReadonlyArray<AchieveBackfillCallId> {
  const seen = new Set<AchieveBackfillCallId>()
  const duplicates = new Set<AchieveBackfillCallId>()
  for (const callId of callIds) {
    if (seen.has(callId)) duplicates.add(callId)
    seen.add(callId)
  }
  return [...duplicates].sort(compareCallIds)
}

/**
 * Validate a frozen 57-ID cohort and produce its deterministic Gate 1 manifest.
 * This function can only perform reads through the supplied inspector.
 */
export async function runAchieveBackfillDryRun(
  inspector: AchieveBackfillInspector,
  callIds: ReadonlyArray<AchieveBackfillCallId>,
): Promise<AchieveBackfillDryRunResult> {
  if (callIds.length !== 57) {
    return { _tag: "rejected", reason: "invalid_candidate_count", callIds: [] }
  }

  const duplicates = duplicateIds(callIds)
  if (duplicates.length > 0) {
    return { _tag: "rejected", reason: "duplicate_call_ids", callIds: duplicates }
  }

  const sortedCallIds = sortedUnique(callIds)
  const inspection = await inspector.inspect(sortedCallIds)
  if (inspection._tag === "failure") {
    return { _tag: "unavailable", reason: inspection.reason }
  }

  const known = new Set(inspection.knownCallIds)
  const unknown = sortedCallIds.filter((callId) => !known.has(callId))
  if (unknown.length > 0) {
    return { _tag: "rejected", reason: "unknown_call_ids", callIds: unknown }
  }

  const conflicts = sortedUnique(inspection.ordinaryResultCallIds)
  if (conflicts.length > 0) {
    return { _tag: "rejected", reason: "ordinary_results_exist", callIds: conflicts }
  }

  const manifest: Manifest = {
    representation_version: REPRESENTATION_VERSION,
    gate: "gate_1_dry_run",
    module_name: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
    snapshot: {
      cutoff: ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF,
      funnel_counts: [378, 101, 89, 88, 65, 57],
    },
    candidate_count: 57,
    candidates: sortedCallIds.map((call_id) => ({
      call_id,
      reason: "approved_frozen_cohort",
      status: "eligible",
    })),
  }

  const digest = await sha256CanonicalJson(manifest)
  if (digest._tag === "failure") {
    return { _tag: "unavailable", reason: "invalid_response" }
  }

  return {
    _tag: "ready",
    manifest,
    digest: {
      algorithm: "SHA-256",
      canonicalization: CANONICALIZATION_VERSION,
      value: digest.value,
    },
  }
}
