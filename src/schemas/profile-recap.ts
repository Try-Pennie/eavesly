import { z } from "zod"

/** A parsed 18-character Salesforce Lead ID. */
export const SalesforceLeadIdSchema = z
  .string()
  .regex(/^00Q[A-Za-z0-9]{15}$/)
  .brand<"SalesforceLeadId">()

/** A parsed Salesforce Lead ID. */
export type SalesforceLeadId = z.infer<typeof SalesforceLeadIdSchema>

/** The only accepted request body for the Skyfall profile recap endpoint. */
export const ProfileRecapRequestSchema = z
  .object({ p_sfdc_lead_id: SalesforceLeadIdSchema })
  .strict()

const ProfileRecapTimelineEntrySchema = z
  .object({
    call_id: z.string(),
    timestamp: z.string().nullable(),
    date: z.string().nullable(),
    time: z.string().nullable(),
    duration_minutes: z.number().nonnegative(),
    agent: z.string().nullable(),
    disposition: z.string().nullable(),
    campaign: z.string().nullable(),
    direction: z.string().nullable(),
    summary: z.string(),
    notes: z.string().nullable(),
  })
  .strict()

/** The JSON projection returned by get_lead_profile_recap_agent_view. */
export const LeadProfileRecapSchema = z
  .object({
    lead_id: SalesforceLeadIdSchema,
    total_calls: z.number().int().nonnegative(),
    timeline: z.array(ProfileRecapTimelineEntrySchema),
  })
  .strict()

/** A parsed profile recap response compatible with Skyfall's existing contract. */
export type LeadProfileRecap = z.infer<typeof LeadProfileRecapSchema>
