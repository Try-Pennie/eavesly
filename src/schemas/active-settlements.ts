import { z } from "zod"

const SettlementMentionSchema = z.object({
  term_used: z.string(),
  speaker: z.string(),
  quote: z.string(),
  context: z.string(),
})

export const EnrolledWithCompetitorSchema = z.enum(["yes", "no", "unclear"])
export const CancellationConfirmedSchema = z.enum(["yes", "no", "unclear", "n/a"])

export const ActiveSettlementsSchema = z.object({
  active_settlements_detected: z.boolean(),
  mentions: z.array(SettlementMentionSchema),
  agent_acknowledged: z.boolean(),
  agent_response_quote: z.string(),

  enrolled_with_competitor: EnrolledWithCompetitorSchema,
  competitor_evidence_quote: z.string(),
  cancellation_confirmed: CancellationConfirmedSchema,
  cancellation_evidence_quote: z.string(),

  violation: z.boolean(),
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type ActiveSettlementsResult = z.infer<typeof ActiveSettlementsSchema>
