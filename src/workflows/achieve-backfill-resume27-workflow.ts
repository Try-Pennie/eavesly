import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import {
  AchieveBackfillResume27RequestSchema,
  type AchieveBackfillResume27Request,
} from "../schemas/achieve-backfill-resume27"
import { ACHIEVE_BACKFILL_APPROVED_DIGEST } from "../services/achieve-backfill-canary"
import {
  ACHIEVE_BACKFILL_RESUME27_AFTER_ORDINAL,
  ACHIEVE_BACKFILL_RESUME27_PROGRESS_FINGERPRINT,
  authorizeAchieveBackfillResume27,
  initializeAchieveBackfillResume27,
  processAchieveBackfillResume27Item,
  type AchieveBackfillResume27Approval,
  type AchieveBackfillResume27Dependencies,
} from "../services/achieve-backfill-resume27"
import { createSupabaseAchieveBackfillResume27Dependencies } from "../services/achieve-backfill-resume27-adapter"
import type { AchieveBackfillRemaining56ItemResult } from "../services/achieve-backfill-remaining56"
import type { Bindings } from "../types/env"

/** No Workflow retry is allowed around an at-most-once grading attempt. */
export const ACHIEVE_BACKFILL_RESUME27_RETRY_LIMIT = 0 as const

/** Cloudflare Workflow instance IDs must be no longer than 64 characters. */
export const ACHIEVE_BACKFILL_RESUME27_INSTANCE_ID_PREFIX = "psai245-r27" as const
export const ACHIEVE_BACKFILL_RESUME27_INSTANCE_ID_HASH_LENGTH = 16 as const

/** Derive a compact deterministic identity from both server-approved immutable artifacts. */
export function achieveBackfillResume27WorkflowInstanceId(
  approvedDigest: string,
  progressStateFingerprint: string,
): string {
  return [
    ACHIEVE_BACKFILL_RESUME27_INSTANCE_ID_PREFIX,
    approvedDigest.slice(0, ACHIEVE_BACKFILL_RESUME27_INSTANCE_ID_HASH_LENGTH),
    progressStateFingerprint.slice(0, ACHIEVE_BACKFILL_RESUME27_INSTANCE_ID_HASH_LENGTH),
  ].join("-")
}

type InitializationResult =
  | { readonly _tag: "ready" }
  | { readonly _tag: "rejected" | "unavailable"; readonly reason: string }

/** Durable-step seam with categorical/ordinal outputs only. */
export interface AchieveBackfillResume27WorkflowSteps {
  /** Execute/replay exact persisted-state authorization. */
  initialize(callback: () => Promise<InitializationResult>): Promise<InitializationResult>
  /** Execute/replay one approved manifest ordinal after 30. */
  process(
    ordinal: number,
    callback: () => Promise<AchieveBackfillRemaining56ItemResult>,
  ): Promise<AchieveBackfillRemaining56ItemResult>
}

/** Categorical aggregate output that contains no IDs, transcript, result, alert, or metadata. */
export type AchieveBackfillResume27WorkflowResult = {
  readonly status: "completed" | "stopped"
  readonly candidate_count: 57
  readonly resume_count: 27
  readonly completed: number
  readonly failed: number
  readonly approved_digest: string
  readonly progress_state_fingerprint: string
  readonly reason?: string
}

const productionApproval: AchieveBackfillResume27Approval = {
  approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST,
  approvedProgressStateFingerprint: ACHIEVE_BACKFILL_RESUME27_PROGRESS_FINGERPRINT,
}

function stopped(
  command: AchieveBackfillResume27Request,
  reason: string,
  completed: number,
  failed: number,
): AchieveBackfillResume27WorkflowResult {
  return {
    status: "stopped",
    reason,
    candidate_count: 57,
    resume_count: 27,
    completed,
    failed,
    approved_digest: command.digest.value,
    progress_state_fingerprint: command.progress_state_fingerprint.value,
  }
}

/** Verify exact artifacts and persisted state, then process only ordinals 31..57 sequentially. */
export async function executeAchieveBackfillResume27Workflow(
  payload: unknown,
  steps: AchieveBackfillResume27WorkflowSteps,
  dependencies: AchieveBackfillResume27Dependencies,
  approval: AchieveBackfillResume27Approval = productionApproval,
): Promise<AchieveBackfillResume27WorkflowResult> {
  const parsed = AchieveBackfillResume27RequestSchema.safeParse(payload)
  if (!parsed.success) throw new Error("Invalid PSAI-245 resume-27 workflow payload")

  const authorization = await authorizeAchieveBackfillResume27(parsed.data, approval)
  if (authorization._tag !== "authorized") return stopped(parsed.data, authorization.reason, 0, 0)

  const initialization = await steps.initialize(async () => {
    const result = await initializeAchieveBackfillResume27(parsed.data, dependencies, approval)
    return result._tag === "ready" ? { _tag: "ready" } : result
  })
  if (initialization._tag !== "ready") return stopped(parsed.data, initialization.reason, 0, 0)

  let completed = 0
  for (const [index, callId] of authorization.pendingCallIds.entries()) {
    const ordinal = ACHIEVE_BACKFILL_RESUME27_AFTER_ORDINAL + index + 1
    const result = await steps.process(ordinal, () => processAchieveBackfillResume27Item(
      parsed.data,
      callId,
      ordinal,
      dependencies,
    ))
    if (result._tag !== "completed") {
      return stopped(
        parsed.data,
        result.reason,
        completed,
        result._tag === "stopped_unknown" ? 0 : 1,
      )
    }
    completed += 1
  }

  return {
    status: "completed",
    candidate_count: 57,
    resume_count: 27,
    completed,
    failed: 0,
    approved_digest: parsed.data.digest.value,
    progress_state_fingerprint: parsed.data.progress_state_fingerprint.value,
  }
}

function asNonRetryable(cause: unknown): NonRetryableError {
  if (cause instanceof NonRetryableError) return cause
  return new NonRetryableError("PSAI-245 resume-27 step failed categorically")
}

/** Dedicated audit-only resume Workflow; it does not use generic evaluation, alerts, or metrics. */
export class AchieveBackfillResume27Workflow extends WorkflowEntrypoint<
  Bindings,
  AchieveBackfillResume27Request
> {
  async run(event: WorkflowEvent<AchieveBackfillResume27Request>, step: WorkflowStep) {
    return executeAchieveBackfillResume27Workflow(
      event.payload,
      {
        async initialize(callback) {
          return step.do("verify-exact-stopped-state", {
            retries: { limit: ACHIEVE_BACKFILL_RESUME27_RETRY_LIMIT, delay: "5 seconds" },
            timeout: "1 minute",
          }, async () => {
            try {
              return await callback()
            } catch (cause: unknown) {
              throw asNonRetryable(cause)
            }
          })
        },
        async process(ordinal, callback) {
          return step.do(`resume-approved-ordinal-${ordinal}`, {
            retries: { limit: ACHIEVE_BACKFILL_RESUME27_RETRY_LIMIT, delay: "5 seconds" },
            timeout: "10 minutes",
          }, async () => {
            try {
              return await callback()
            } catch (cause: unknown) {
              throw asNonRetryable(cause)
            }
          })
        },
      },
      createSupabaseAchieveBackfillResume27Dependencies(this.env),
    )
  }
}
