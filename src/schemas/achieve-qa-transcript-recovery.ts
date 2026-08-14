import { z } from "zod"
import { AchieveQaRecoveryCallIdSchema } from "./achieve-qa-recovery"
import { TranscriptAvailableEventSchema } from "./regal-events"

/** Exact size of the privately reviewed Snowflake transcript recovery artifact. */
export const ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT = 12 as const

/** Recovery-only source bound; ordinary canonical and evaluation schemas remain capped at 200,000. */
export const ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH = 262_144 as const

/** Strict canonical transcript event accepted only by the bounded recovery route and ledger reader. */
export const AchieveQaTranscriptRecoverySourceEventSchema = TranscriptAvailableEventSchema.extend({
  regal_task_id: AchieveQaRecoveryCallIdSchema,
  transcript: z.string().max(ACHIEVE_QA_TRANSCRIPT_RECOVERY_SOURCE_MAX_LENGTH),
  transcript_is_truncated: z.literal(false).optional(),
}).strict().superRefine((event, context) => {
  if (event.transcript.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Transcript must be nonblank",
      path: ["transcript"],
    })
  }
})

/** Parsed recovery-scoped source event. */
export type AchieveQaTranscriptRecoverySourceEvent = z.infer<
  typeof AchieveQaTranscriptRecoverySourceEventSchema
>

/** Digest binding execution to one exact private twelve-event source snapshot. */
export const AchieveQaTranscriptRecoveryDigestSchema = z.object({
  algorithm: z.literal("SHA-256"),
  canonicalization: z.literal("achieve-qa-transcript-recovery-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** Strict dry-run or execution command for the dedicated transcript-ledger recovery route. */
export const AchieveQaTranscriptRecoveryRequestSchema = z.object({
  events: z.array(AchieveQaTranscriptRecoverySourceEventSchema)
    .length(ACHIEVE_QA_TRANSCRIPT_RECOVERY_EVENT_COUNT),
  dry_run: z.boolean().default(true),
  digest: AchieveQaTranscriptRecoveryDigestSchema.optional(),
}).strict().superRefine((command, context) => {
  if (new Set(command.events.map((event) => event.regal_task_id)).size !== command.events.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate event IDs", path: ["events"] })
  }
  if (!command.dry_run && command.digest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Execution digest required", path: ["digest"] })
  }
  if (command.dry_run && command.digest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Dry run must not include digest", path: ["digest"] })
  }
})

/** Parsed transcript-ledger recovery command. */
export type AchieveQaTranscriptRecoveryRequest = z.infer<
  typeof AchieveQaTranscriptRecoveryRequestSchema
>
