import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { Bindings } from "../types/env"
import {
  runApprovedAchieveQaRecovery,
  type AchieveQaRecoveryExecutionDependencies,
  type AchieveQaRecoveryExecutionResult,
  type AchieveQaRecoveryWorkflowCommand,
} from "../services/achieve-qa-recovery"
import { createSupabaseAchieveQaRecoveryDependencies } from "../services/achieve-qa-recovery-adapter"

/** Workflow retries are forbidden so each approved candidate receives at most one application send. */
export const ACHIEVE_QA_RECOVERY_RETRY_LIMIT = 0 as const

/** Aggregate-only durable step seam for the complete bounded recovery batch. */
export interface AchieveQaRecoveryWorkflowSteps {
  /** Execute or replay the exact approved batch without persisting private inputs in step output. */
  execute(callback: () => Promise<AchieveQaRecoveryExecutionResult>): Promise<AchieveQaRecoveryExecutionResult>
}

/** Execute one digest-bound recovery batch through a single no-retry durable step. */
export async function executeAchieveQaRecoveryWorkflow(
  payload: unknown,
  steps: AchieveQaRecoveryWorkflowSteps,
  dependencies: AchieveQaRecoveryExecutionDependencies,
  serverApprovedDigest: string | undefined,
): Promise<AchieveQaRecoveryExecutionResult> {
  return steps.execute(() => runApprovedAchieveQaRecovery(
    payload,
    dependencies,
    serverApprovedDigest,
  ))
}

function asNonRetryable(cause: unknown): NonRetryableError {
  if (cause instanceof NonRetryableError) return cause
  return new NonRetryableError("Achieve QA recovery failed categorically")
}

/** Dedicated no-alert Workflow for insert-only ordinary Achieve QA recovery results. */
export class AchieveQaRecoveryWorkflow extends WorkflowEntrypoint<
  Bindings,
  AchieveQaRecoveryWorkflowCommand
> {
  async run(
    event: WorkflowEvent<AchieveQaRecoveryWorkflowCommand>,
    step: WorkflowStep,
  ): Promise<AchieveQaRecoveryExecutionResult> {
    return executeAchieveQaRecoveryWorkflow(
      event.payload,
      {
        async execute(callback) {
          return step.do("execute-approved-achieve-qa-recovery-once", {
            retries: { limit: ACHIEVE_QA_RECOVERY_RETRY_LIMIT, delay: "5 seconds" },
            timeout: "30 minutes",
          }, async () => {
            try {
              return await callback()
            } catch (cause: unknown) {
              throw asNonRetryable(cause)
            }
          })
        },
      },
      createSupabaseAchieveQaRecoveryDependencies(this.env),
      this.env.ACHIEVE_QA_RECOVERY_APPROVED_DIGEST,
    )
  }
}
