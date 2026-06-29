import { z } from "zod"

export const AchieveWelcomeCallQASchema = z.object({
  // partner_id and script_version are stamped here because eavesly_module_results
  // has no partner_id column. They live in result_json for observability/querying.
  partner_id: z.literal("achieve"),
  script_version: z.string(),

  script_adherence: z.object({
    welcome_greeting_completed: z.boolean(),
    program_overview_covered: z.boolean(),
    timeline_expectations_covered: z.boolean(),
    payment_process_explained: z.boolean(),
    client_communication_process_covered: z.boolean(),
    next_steps_provided: z.boolean(),

    overall_script_adherence: z.enum(["full", "partial", "minimal"]),

    missing_elements: z.array(z.string()),
    key_evidence_quotes: z.array(z.string()),

    violation: z.boolean(),
    violation_reason: z.string(),
  }),

  call_overview: z.object({
    call_outcome: z.string(),
    agent_tone: z.enum(["professional", "neutral", "unprofessional"]),
    client_engagement: z.enum(["engaged", "neutral", "disengaged"]),
    notes: z.string(),
  }),
})

export type AchieveWelcomeCallQAResult = z.infer<typeof AchieveWelcomeCallQASchema>
