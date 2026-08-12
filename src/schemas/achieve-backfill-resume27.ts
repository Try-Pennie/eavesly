import { z } from "zod"
import { AchieveBackfillRemaining56RequestSchema } from "./achieve-backfill-remaining56"

/** Canonical categorical production-state representation approved for forward-only resume. */
export const ACHIEVE_BACKFILL_RESUME27_PROGRESS_CANONICALIZATION = "psai-245-resume-progress-state-v1" as const

/** Strict fingerprint of the persisted state from which the 27-call resume may start. */
export const AchieveBackfillProgressStateFingerprintSchema = z.object({
  algorithm: z.literal("SHA-256"),
  canonicalization: z.literal(ACHIEVE_BACKFILL_RESUME27_PROGRESS_CANONICALIZATION),
  value: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** Exact Gate 3 command plus the separately approved persisted-state fingerprint. */
export const AchieveBackfillResume27RequestSchema = AchieveBackfillRemaining56RequestSchema.extend({
  progress_state_fingerprint: AchieveBackfillProgressStateFingerprintSchema,
}).strict()

/** Parsed PSAI-245 forward-only resume command. */
export type AchieveBackfillResume27Request = z.infer<typeof AchieveBackfillResume27RequestSchema>
