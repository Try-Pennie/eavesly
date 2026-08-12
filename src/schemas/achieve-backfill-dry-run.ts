import { z } from "zod"

/** One opaque call identifier accepted by the PSAI-245 Gate 1 boundary. */
export const AchieveBackfillCallIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .brand<"AchieveBackfillCallId">()

/** A parsed call identifier for the approved Achieve backfill cohort. */
export type AchieveBackfillCallId = z.infer<typeof AchieveBackfillCallIdSchema>

/** The immutable production snapshot cutoff for the approved cohort lineage. */
export const ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF = "2026-08-11T16:21:44.777859Z" as const

/** The exact ID-only request accepted by PSAI-245 Gate 1. */
export const AchieveBackfillDryRunRequestSchema = z
  .object({
    snapshot_cutoff: z.literal(ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF),
    call_ids: z.array(AchieveBackfillCallIdSchema).length(57),
  })
  .strict()

/** Parsed PSAI-245 Gate 1 request. */
export type AchieveBackfillDryRunRequest = z.infer<typeof AchieveBackfillDryRunRequestSchema>
