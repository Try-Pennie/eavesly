import { z } from "zod"

export const RunIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._:-]+$/, "run_id must be an audit-safe identifier")

/**
 * Execution policy carried across the HTTP -> Workflow runtime boundary.
 * Backfill is a closed operational mode: Slack stays suppressed and the
 * existing source-transcript row is enriched instead of duplicated.
 */
export const EvaluationExecutionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("live") }),
  z.strictObject({
    mode: z.literal("backfill"),
    run_id: RunIdSchema,
  }),
])

export type EvaluationExecution = z.infer<typeof EvaluationExecutionSchema>

export const LIVE_EVALUATION_EXECUTION: EvaluationExecution = { mode: "live" }
