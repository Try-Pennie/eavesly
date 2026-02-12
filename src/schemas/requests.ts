import { z } from "zod"

export const TranscriptMetadataSchema = z.object({
  duration: z.number().int().positive(),
  timestamp: z.string(),
  talk_time: z.number().int().positive().optional(),
  disposition: z.string().min(1),
  campaign_name: z.string().optional(),
})

export const TranscriptDataSchema = z.object({
  transcript: z.string().min(1),
  metadata: TranscriptMetadataSchema,
})

export const ScriptProgressSchema = z.object({
  sections_attempted: z.array(z.number().int()).min(1),
  last_completed_section: z.number().int().min(0),
  termination_reason: z.string().min(1),
  pitch_outcome: z.string().optional(),
})

export const FinancialProfileSchema = z.object({
  annual_income: z.number().positive().optional(),
  dti_ratio: z.number().min(0).max(1).optional(),
  loan_approval_status: z.enum(["approved", "denied", "pending"]).optional(),
  has_existing_debt: z.boolean().optional(),
})

export const ClientDataSchema = z.object({
  lead_id: z.string().optional(),
  campaign_id: z.number().int().optional(),
  script_progress: ScriptProgressSchema,
  financial_profile: FinancialProfileSchema.optional(),
})

export const EvaluateRequestSchema = z.object({
  call_id: z.string().min(1),
  agent_id: z.string().min(1),
  call_context: z.enum(["First Call", "Follow-up Call"]),
  transcript: TranscriptDataSchema,
  ideal_script: z.string().min(1),
  client_data: ClientDataSchema,
})

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>

export const BatchEvaluateRequestSchema = z.object({
  calls: z.array(EvaluateRequestSchema).min(1).max(20),
})

export type BatchEvaluateRequest = z.infer<typeof BatchEvaluateRequestSchema>
