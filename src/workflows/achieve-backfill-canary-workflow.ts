import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { AchieveBackfillCanaryRequestSchema } from "../schemas/achieve-backfill-canary"
import type { AchieveBackfillCanaryRequest } from "../schemas/achieve-backfill-canary"
import type { Bindings } from "../types/env"
import {
  ACHIEVE_BACKFILL_APPROVED_DIGEST,
  ACHIEVE_BACKFILL_CANARY_ID,
  runAchieveBackfillCanary,
  type AchieveBackfillCanaryApproval,
  type AchieveBackfillCanaryDependencies,
  type AchieveBackfillCanaryResult,
} from "../services/achieve-backfill-canary"
import { createSupabaseAchieveBackfillCanaryDependencies } from "../services/achieve-backfill-canary-adapter"

/** Automatic execution retries are forbidden: one approved canary gets one LLM attempt. */
export const ACHIEVE_BACKFILL_CANARY_RETRY_LIMIT = 0 as const

/** Deterministic one-instance identity: every member selection shares this ID. */
export function achieveBackfillCanaryWorkflowInstanceId(approvedDigest: string): string {
  return `${ACHIEVE_BACKFILL_CANARY_ID}-${approvedDigest}`
}

type CategoricalWorkflowResult = {
  readonly status: AchieveBackfillCanaryResult["_tag"]
  readonly reason?: string
  readonly candidate_count: 57
  readonly approved_digest: string
}

/** Minimal durable-step seam used to prove that the whole canary executes once. */
export interface AchieveBackfillCanaryWorkflowSteps {
  /** Execute or replay the one private grading/finalization operation. */
  execute(callback: () => Promise<CategoricalWorkflowResult>): Promise<CategoricalWorkflowResult>
}

function toCategoricalWorkflowResult(
  result: AchieveBackfillCanaryResult,
  command: AchieveBackfillCanaryRequest,
): CategoricalWorkflowResult {
  return {
    status: result._tag,
    ...(result._tag === "rejected" || result._tag === "unavailable"
      ? { reason: result.reason }
      : {}),
    candidate_count: command.manifest.candidate_count,
    approved_digest: command.digest.value,
  }
}

/** Parse the runtime payload and durably execute one private grading attempt. */
export async function executeAchieveBackfillCanaryWorkflow(
  payload: unknown,
  steps: AchieveBackfillCanaryWorkflowSteps,
  dependencies: AchieveBackfillCanaryDependencies,
  approval: AchieveBackfillCanaryApproval = {
    approvedDigest: ACHIEVE_BACKFILL_APPROVED_DIGEST,
  },
): Promise<CategoricalWorkflowResult> {
  // Workflow payloads cross a serialization boundary and must be parsed again.
  const parsed = AchieveBackfillCanaryRequestSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error("Invalid PSAI-245 canary workflow payload")
  }
  if (parsed.data.digest.value !== approval.approvedDigest) {
    throw new Error("Unapproved PSAI-245 canary workflow payload")
  }

  return steps.execute(async () => {
    const result = await runAchieveBackfillCanary(
      parsed.data,
      dependencies,
      approval,
    )
    // Only this categorical projection becomes a durable Workflow artifact.
    return toCategoricalWorkflowResult(result, parsed.data)
  })
}

/** Dedicated PSAI-245 canary Workflow; it never invokes the generic evaluation Workflow. */
export class AchieveBackfillCanaryWorkflow extends WorkflowEntrypoint<
  Bindings,
  AchieveBackfillCanaryRequest
> {
  async run(
    event: WorkflowEvent<AchieveBackfillCanaryRequest>,
    step: WorkflowStep,
  ) {
    return executeAchieveBackfillCanaryWorkflow(
      event.payload,
      {
        async execute(callback) {
          return step.do("execute-approved-canary-once", {
            retries: {
              limit: ACHIEVE_BACKFILL_CANARY_RETRY_LIMIT,
              delay: "5 seconds",
              backoff: "exponential",
            },
            timeout: "10 minutes",
          }, callback)
        },
      },
      createSupabaseAchieveBackfillCanaryDependencies(this.env),
    )
  }
}
