import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { AchieveBackfillCallId } from "../schemas/achieve-backfill-dry-run"
import type { Bindings } from "../types/env"
import { createSupabaseAchieveBackfillRemaining56Dependencies } from "./achieve-backfill-remaining56-adapter"
import type { AchieveBackfillRemaining56Dependencies } from "./achieve-backfill-remaining56"
import type {
  AchieveBackfillResume27Context,
  AchieveBackfillResume27Dependencies,
} from "./achieve-backfill-resume27"

const InitializeSchema = z.array(z.object({
  status: z.enum(["ready", "state_drift", "different_authorization"]),
}).strict()).length(1)
const ClaimSchema = z.array(z.object({
  status: z.enum(["claimed", "attempted", "completed", "failed", "rejected"]),
}).strict()).length(1)

type BoundaryResponse = { readonly data: unknown; readonly error: unknown | null }

/** Raw resume-only RPC operations hidden behind the parsed persistence adapter. */
export interface AchieveBackfillResume27DataAccess {
  /** Verify the production fixture and insert/replay immutable resume authorization. */
  initialize(context: AchieveBackfillResume27Context): Promise<BoundaryResponse>
  /** Claim one authorized pending ordinal after 30. */
  claim(context: AchieveBackfillResume27Context, callId: AchieveBackfillCallId): Promise<BoundaryResponse>
}

function contextRpc(context: AchieveBackfillResume27Context) {
  return {
    p_call_ids: [...context.callIds],
    p_completed_canary_call_id: context.completedCanaryCallId,
    p_approved_digest: context.approvedDigest,
    p_manifest_version: context.manifestVersion,
    p_snapshot_cutoff: context.snapshotCutoff,
    p_progress_state_fingerprint: context.progressStateFingerprint,
  }
}

function createDataAccess(env: Bindings): AchieveBackfillResume27DataAccess {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return {
    async initialize(context) {
      return client.rpc("eavesly_initialize_achieve_backfill_resume27_v1", contextRpc(context))
    },
    async claim(context, callId) {
      return client.rpc("eavesly_claim_achieve_backfill_resume27_v1", {
        p_call_id: callId,
        p_approved_digest: context.approvedDigest,
        p_completed_canary_call_id: context.completedCanaryCallId,
        p_progress_state_fingerprint: context.progressStateFingerprint,
      })
    },
  }
}

async function boundaryCall(
  operation: () => Promise<BoundaryResponse>,
): Promise<BoundaryResponse | undefined> {
  try {
    const response = await operation()
    return response.error === null ? response : undefined
  } catch {
    return undefined
  }
}

/**
 * Build forward-only resume dependencies.
 *
 * Preparation, one-shot grading, audit finalization, and terminal failure persistence are the
 * unchanged Gate 3 implementations; only initialization and claim use additive resume RPCs.
 */
export function createSupabaseAchieveBackfillResume27Dependencies(
  env: Bindings,
  dataAccess?: AchieveBackfillResume27DataAccess,
  remainingDependencies?: AchieveBackfillRemaining56Dependencies,
): AchieveBackfillResume27Dependencies {
  const access = dataAccess ?? createDataAccess(env)
  const gate3 = remainingDependencies ?? createSupabaseAchieveBackfillRemaining56Dependencies(env)
  return {
    prepare: gate3.prepare,
    grade: gate3.grade,
    finalize: gate3.finalize,
    recordFailure: gate3.recordFailure,
    async initialize(context) {
      const response = await boundaryCall(() => access.initialize(context))
      if (response === undefined) return { _tag: "failure", reason: "write_unavailable" }
      const parsed = InitializeSchema.safeParse(response.data)
      if (!parsed.success) return { _tag: "failure", reason: "invalid_response" }
      const status = parsed.data[0].status
      if (status === "ready") return { _tag: "ready" }
      return { _tag: "rejected", reason: status }
    },
    async claim(context, callId) {
      const response = await boundaryCall(() => access.claim(context, callId))
      if (response === undefined) return { _tag: "failure", reason: "write_unavailable" }
      const parsed = ClaimSchema.safeParse(response.data)
      if (!parsed.success) return { _tag: "failure", reason: "invalid_response" }
      const status = parsed.data[0].status
      if (status === "claimed") return { _tag: "claimed" }
      if (status === "rejected") return { _tag: "rejected" }
      return { _tag: "already_attempted", status }
    },
  }
}
