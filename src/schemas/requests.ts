import { z } from "zod"
import {
  EvaluationExecutionSchema,
  LIVE_EVALUATION_EXECUTION,
  RunIdSchema,
} from "./evaluation-execution"

const TranscriptMetadataSchema = z.object({
  duration: z.coerce.number().nonnegative(),
  timestamp: z.string(),
  talk_time: z.coerce.number().nonnegative().optional(),
  disposition: z.string().optional(),
  campaign_name: z.string().optional(),
})

const TranscriptDataSchema = z.object({
  transcript: z.string().max(200000),
  metadata: TranscriptMetadataSchema,
})

export const EvaluateRequestSchema = z.object({
  call_id: z.string().min(1),
  regal_task_id: z.string().optional(),
  agent_id: z.string(),
  transcript: TranscriptDataSchema,
  agent_email: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  recording_link: z.string().optional(),
  call_summary: z.string().optional(),
  transcript_url: z.string().optional(),
  sfdc_lead_id: z.string().optional(),
})

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>

export const BatchEvaluateRequestSchema = z.object({
  calls: z.array(EvaluateRequestSchema).min(1).max(10),
  execution: EvaluationExecutionSchema.default(LIVE_EVALUATION_EXECUTION),
})

type BatchEvaluateRequest = z.infer<typeof BatchEvaluateRequestSchema>

export const BackfillEvaluateRequestSchema = z.strictObject({
  call_ids: z.array(z.string().min(1)).min(1).max(10),
  run_id: RunIdSchema,
})

export const BackfillNextRequestSchema = z.strictObject({
  start: z.string().datetime(),
  end: z.string().datetime(),
  after_call_id: z.string().min(1).optional(),
  filter: z.enum(["all", "enrollment"]).default("all"),
  limit: z.number().int().min(1).max(10).default(10),
  discover_only: z.boolean().default(false),
  run_id: RunIdSchema,
})

const FromRecordingMetadataSchema = z.object({
  timestamp: z.string(),
  duration: z.coerce.number().nonnegative().optional(),
  talk_time: z.coerce.number().nonnegative().optional(),
  disposition: z.string().optional(),
  campaign_name: z.string().optional(),
})

export const EvaluateFromRecordingRequestSchema = z.object({
  call_id: z.string().min(1),
  regal_task_id: z.string().optional(),
  agent_id: z.string(),
  recording_url: z.string().url(),
  recording_source: z.literal("twilio").default("twilio"),
  metadata: FromRecordingMetadataSchema,
  agent_email: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  call_summary: z.string().optional(),
  transcript_url: z.string().optional(),
  sfdc_lead_id: z.string().optional(),
})
