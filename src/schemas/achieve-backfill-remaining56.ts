import { z } from "zod"
import {
  ACHIEVE_BACKFILL_CANONICALIZATION_VERSION,
  ACHIEVE_BACKFILL_MANIFEST_VERSION,
  AchieveBackfillManifestSchema,
} from "./achieve-backfill-canary"
import { AchieveBackfillCallIdSchema } from "./achieve-backfill-dry-run"

/** Strict completed-canary provenance supplied with the separately gated remaining-56 command. */
export const AchieveBackfillCompletedCanarySchema = z.object({
  call_id: AchieveBackfillCallIdSchema,
  audit_only: z.literal(true),
  approved_digest: z.string().regex(/^[a-f0-9]{64}$/),
  batch_id: z.literal("psai-245-gate-2-approved-manifest"),
  canary_id: z.literal("psai-245-gate-2-one-call-canary"),
  manifest_version: z.literal(ACHIEVE_BACKFILL_MANIFEST_VERSION),
  snapshot_cutoff: z.literal("2026-08-11T16:21:44.777859Z"),
}).strict()

/** Exact-digest, ID-only command for the approved manifest minus its completed canary. */
export const AchieveBackfillRemaining56RequestSchema = z.object({
  manifest: AchieveBackfillManifestSchema,
  digest: z.object({
    algorithm: z.literal("SHA-256"),
    canonicalization: z.literal(ACHIEVE_BACKFILL_CANONICALIZATION_VERSION),
    value: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  completed_canary: AchieveBackfillCompletedCanarySchema,
}).strict()

/** Parsed PSAI-245 remaining-56 execution command. */
export type AchieveBackfillRemaining56Request = z.infer<typeof AchieveBackfillRemaining56RequestSchema>
