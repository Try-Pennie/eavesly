import { z } from "zod"
import {
  ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF,
  AchieveBackfillCallIdSchema,
} from "./achieve-backfill-dry-run"

/** Gate 1 manifest representation approved for PSAI-245 Gate 2. */
export const ACHIEVE_BACKFILL_MANIFEST_VERSION = "psai-245-achieve-backfill-manifest-v1" as const

/** Canonical JSON representation used by the approved Gate 1 digest. */
export const ACHIEVE_BACKFILL_CANONICALIZATION_VERSION = "eavesly-canonical-json-v1" as const

const CandidateSchema = z.object({
  call_id: AchieveBackfillCallIdSchema,
  reason: z.literal("approved_frozen_cohort"),
  status: z.literal("eligible"),
}).strict()

/** Exact structural representation of the PSAI-245 Gate 1 manifest. */
export const AchieveBackfillManifestSchema = z.object({
  representation_version: z.literal(ACHIEVE_BACKFILL_MANIFEST_VERSION),
  gate: z.literal("gate_1_dry_run"),
  module_name: z.literal("achieve_welcome_call_qa"),
  snapshot: z.object({
    cutoff: z.literal(ACHIEVE_BACKFILL_SNAPSHOT_CUTOFF),
    funnel_counts: z.tuple([
      z.literal(378),
      z.literal(101),
      z.literal(89),
      z.literal(88),
      z.literal(65),
      z.literal(57),
    ]),
  }).strict(),
  candidate_count: z.literal(57),
  candidates: z.array(CandidateSchema).length(57),
}).strict()

/** Strict ID-only Gate 2 command containing one complete Gate 1 approval artifact. */
export const AchieveBackfillCanaryRequestSchema = z.object({
  manifest: AchieveBackfillManifestSchema,
  digest: z.object({
    algorithm: z.literal("SHA-256"),
    canonicalization: z.literal(ACHIEVE_BACKFILL_CANONICALIZATION_VERSION),
    value: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  canary_call_id: AchieveBackfillCallIdSchema,
}).strict()

/** Parsed PSAI-245 Gate 2 one-call command. */
export type AchieveBackfillCanaryRequest = z.infer<typeof AchieveBackfillCanaryRequestSchema>
