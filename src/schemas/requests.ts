import { z } from "zod"

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

/**
 * Deterministic Regal lead metadata carried inward from customProperties. Drives
 * server-owned Achieve guide selection (California > red/green) independently of
 * the model's transcript read. Both fields are optional because older Regal
 * events predate them.
 */
export const LeadContextSchema = z.object({
  legal_state: z.string().max(32).optional(),
  client_state: z.string().max(32).optional(),
})

export type LeadContext = z.infer<typeof LeadContextSchema>

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
  lead_context: LeadContextSchema.optional(),
})

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>

export const BatchEvaluateRequestSchema = z.object({
  calls: z.array(EvaluateRequestSchema).min(1).max(10),
})

type BatchEvaluateRequest = z.infer<typeof BatchEvaluateRequestSchema>

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
