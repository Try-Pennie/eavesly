import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { AchieveBackfillRemaining56RequestSchema, type AchieveBackfillRemaining56Request } from "../schemas/achieve-backfill-remaining56"
import type { Bindings } from "../types/env"
import { ACHIEVE_BACKFILL_APPROVED_DIGEST } from "../services/achieve-backfill-canary"
import {
  ACHIEVE_BACKFILL_REMAINING56_ID,
  authorizeAchieveBackfillRemaining56,
  initializeAchieveBackfillRemaining56,
  processAchieveBackfillRemaining56Item,
  type AchieveBackfillRemaining56Approval,
  type AchieveBackfillRemaining56Dependencies,
  type AchieveBackfillRemaining56ItemResult,
} from "../services/achieve-backfill-remaining56"
import { createSupabaseAchieveBackfillRemaining56Dependencies } from "../services/achieve-backfill-remaining56-adapter"

/** Matches the production-proven Gate 2 no-retry configuration. */
export const ACHIEVE_BACKFILL_REMAINING56_RETRY_LIMIT = 0 as const

/** One deterministic Workflow instance for the exact approved remaining-56 capability. */
export function achieveBackfillRemaining56WorkflowInstanceId(approvedDigest: string): string {
  return `${ACHIEVE_BACKFILL_REMAINING56_ID}-${approvedDigest}`
}

type InitializationResult =
  | { readonly _tag: "ready" }
  | { readonly _tag: "rejected" | "unavailable"; readonly reason: string }

/** Durable-step seam for initialization and 56 ordinal-only item operations. */
export interface AchieveBackfillRemaining56WorkflowSteps {
  /** Execute/replay exact cohort initialization. */
  initialize(callback: () => Promise<InitializationResult>): Promise<InitializationResult>
  /** Execute/replay one manifest ordinal. */
  process(
    ordinal: number,
    callback: () => Promise<AchieveBackfillRemaining56ItemResult>,
  ): Promise<AchieveBackfillRemaining56ItemResult>
}

/** Safe aggregate Workflow output; individual durable step outputs are ordinal/categorical only. */
export type AchieveBackfillRemaining56WorkflowResult = {
  readonly status: "completed" | "stopped"
  readonly candidate_count: 57
  readonly remaining_count: 56
  readonly completed: number
  readonly skipped: number
  readonly failed: number
  readonly approved_digest: string
  readonly reason?: string
}

/** Parse the runtime payload, verify the canary, then process exactly its remaining 56 ordinals. */
export async function executeAchieveBackfillRemaining56Workflow(
  payload: unknown,
  steps: AchieveBackfillRemaining56WorkflowSteps,
  dependencies: AchieveBackfillRemaining56Dependencies,
  approval: AchieveBackfillRemaining56Approval = { approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST },
): Promise<AchieveBackfillRemaining56WorkflowResult> {
  const parsed = AchieveBackfillRemaining56RequestSchema.safeParse(payload)
  if (!parsed.success) throw new Error("Invalid PSAI-245 remaining-56 workflow payload")

  const authorization = await authorizeAchieveBackfillRemaining56(parsed.data, approval)
  if (authorization._tag !== "authorized") {
    return {
      status: "stopped",
      reason: authorization.reason,
      candidate_count: 57,
      remaining_count: 56,
      completed: 0,
      skipped: 0,
      failed: 0,
      approved_digest: parsed.data.digest.value,
    }
  }

  const initialization = await steps.initialize(async () => {
    const result = await initializeAchieveBackfillRemaining56(
      parsed.data,
      dependencies,
      approval,
    )
    // IDs remain in the in-memory authorization value, never in a durable step result.
    return result._tag === "ready" ? { _tag: "ready" } : result
  })
  if (initialization._tag !== "ready") {
    return {
      status: "stopped",
      reason: initialization.reason,
      candidate_count: 57,
      remaining_count: 56,
      completed: 0,
      skipped: 0,
      failed: 0,
      approved_digest: parsed.data.digest.value,
    }
  }

  let completed = 0
  for (const callId of authorization.remainingCallIds) {
    const ordinal = parsed.data.manifest.candidates.findIndex(
      (candidate) => candidate.call_id === callId,
    ) + 1
    const result = await steps.process(ordinal, () => processAchieveBackfillRemaining56Item(
      parsed.data,
      callId,
      ordinal,
      dependencies,
    ))
    if (result._tag !== "completed") {
      return {
        status: "stopped",
        reason: result.reason,
        candidate_count: 57,
        remaining_count: 56,
        completed,
        skipped: 0,
        failed: result._tag === "stopped_unknown" ? 0 : 1,
        approved_digest: parsed.data.digest.value,
      }
    }
    completed += 1
  }

  return {
    status: "completed",
    candidate_count: 57,
    remaining_count: 56,
    completed,
    skipped: 0,
    failed: 0,
    approved_digest: parsed.data.digest.value,
  }
}

function asNonRetryable(cause: unknown): NonRetryableError {
  if (cause instanceof NonRetryableError) return cause
  return new NonRetryableError("PSAI-245 remaining-56 step failed categorically")
}

/** Dedicated bounded Workflow; it never uses generic evaluation, alerts, or ordinary metrics. */
export class AchieveBackfillRemaining56Workflow extends WorkflowEntrypoint<
  Bindings,
  AchieveBackfillRemaining56Request
> {
  async run(event: WorkflowEvent<AchieveBackfillRemaining56Request>, step: WorkflowStep) {
    return executeAchieveBackfillRemaining56Workflow(
      event.payload,
      {
        async initialize(callback) {
          return step.do("initialize-approved-remaining-56", {
            retries: { limit: ACHIEVE_BACKFILL_REMAINING56_RETRY_LIMIT, delay: "5 seconds" },
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
          return step.do(`process-approved-ordinal-${ordinal}`, {
            retries: { limit: ACHIEVE_BACKFILL_REMAINING56_RETRY_LIMIT, delay: "5 seconds" },
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
      createSupabaseAchieveBackfillRemaining56Dependencies(this.env),
    )
  }
}
