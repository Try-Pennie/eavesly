import { z } from "zod"

export const TranscriptMetadataSchema = z.object({
  duration: z.coerce.number().nonnegative(),
  timestamp: z.string(),
  talk_time: z.coerce.number().nonnegative().optional(),
  disposition: z.string().optional(),
  campaign_name: z.string().optional(),
})

export const TranscriptDataSchema = z.object({
  transcript: z.string().max(200000),
  metadata: TranscriptMetadataSchema,
})

export const EvaluateRequestSchema = z.object({
  call_id: z.string().min(1),
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
})

export type BatchEvaluateRequest = z.infer<typeof BatchEvaluateRequestSchema>
