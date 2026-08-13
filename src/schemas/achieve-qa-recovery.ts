import { z } from "zod"

/** Exact size of the privately reviewed Achieve QA gap artifact. */
export const ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT = 17 as const

/** Opaque call identifier accepted by the Achieve QA recovery boundary. */
export const AchieveQaRecoveryCallIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .brand<"AchieveQaRecoveryCallId">()

/** Parsed opaque recovery call identifier. */
export type AchieveQaRecoveryCallId = z.infer<typeof AchieveQaRecoveryCallIdSchema>

/** Digest that binds an execution command to one exact dry-run classification. */
export const AchieveQaRecoveryDigestSchema = z.object({
  algorithm: z.literal("SHA-256"),
  canonicalization: z.literal("achieve-qa-gap-recovery-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** Strict, ID-only dry-run or execution command. Execution requires the dry-run digest. */
export const AchieveQaRecoveryRequestSchema = z.object({
  call_ids: z.array(AchieveQaRecoveryCallIdSchema).length(ACHIEVE_QA_RECOVERY_CANDIDATE_COUNT),
  dry_run: z.boolean().default(true),
  digest: AchieveQaRecoveryDigestSchema.optional(),
}).strict().superRefine((command, context) => {
  if (new Set(command.call_ids).size !== command.call_ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate call IDs" })
  }
  if (!command.dry_run && command.digest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Execution digest required", path: ["digest"] })
  }
  if (command.dry_run && command.digest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Dry run must not include digest", path: ["digest"] })
  }
})

/** Parsed Achieve QA recovery command. */
export type AchieveQaRecoveryRequest = z.infer<typeof AchieveQaRecoveryRequestSchema>
