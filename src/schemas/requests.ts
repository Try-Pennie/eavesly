import { z } from "zod"

export const TranscriptMetadataSchema = z.object({
  duration: z.number().int().positive(),
  timestamp: z.string(),
  talk_time: z.number().int().positive().optional(),
  disposition: z.string().min(1).optional(),
  campaign_name: z.string().optional(),
})

export const TranscriptDataSchema = z.object({
  transcript: z.string().min(1),
  metadata: TranscriptMetadataSchema,
})

export const EvaluateRequestSchema = z.object({
  call_id: z.string().min(1),
  agent_id: z.string().min(1),
  transcript: TranscriptDataSchema,
})

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>

export const BatchEvaluateRequestSchema = z.object({
  calls: z.array(EvaluateRequestSchema).min(1).max(20),
})

export type BatchEvaluateRequest = z.infer<typeof BatchEvaluateRequestSchema>
