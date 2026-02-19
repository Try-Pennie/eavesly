import { z } from "zod"

const LitigationMentionSchema = z.object({
  term_used: z.string(),
  speaker: z.string(),
  quote: z.string(),
  context: z.string(),
})

export const LitigationCheckSchema = z.object({
  litigation_discussed: z.boolean(),
  mentions: z.array(LitigationMentionSchema),
  agent_communicated_restriction: z.boolean(),
  agent_response_quote: z.string(),
  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type LitigationCheckResult = z.infer<typeof LitigationCheckSchema>
