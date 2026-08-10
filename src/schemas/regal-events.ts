import { z } from "zod"

/**
 * Canonical Regal journey webhook payloads.
 *
 * Regal journeys are configured to POST a *custom canonical* payload (not the
 * raw Regal event envelope) to Eavesly. v1 only parses these two shapes; we do
 * not attempt to interpret arbitrary raw Regal events. `raw_event` is kept as an
 * opaque passthrough for debugging/replay.
 *
 * Noah confirmed the transcript `task_id` and the completed-call `call_id` are
 * the same Regal task ID — both are normalized to `regal_task_id`.
 */

const RegalBooleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") return true
    if (normalized === "false") return false
  }
  return value
}, z.boolean())

const CustomPropertiesSchema = z
  .object({
    // Warm-transfer gate and red/green GOTA guide selector.
    LegalState: z.string().max(32).optional(),
    // California takes precedence over LegalState for the GOTA guide.
    clientState: z.string().max(32).optional(),
    // Litigation/collections gate: collectionsBalance > 1
    collectionsBalance: z.coerce.number().optional(),
  })
  .passthrough()

export const TranscriptAvailableEventSchema = z.object({
  event_type: z.literal("transcript_available"),
  regal_task_id: z.string().min(1),
  agent_email: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  sfdc_lead_id: z.string().optional(),
  call_summary: z.string().optional(),
  recording_id: z.string().optional(),
  recording_link: z.string().optional(),
  recording_duration: z.coerce.number().nonnegative().optional(),
  transcript: z.string().max(200000).optional(),
  transcript_is_truncated: RegalBooleanSchema.optional(),
  transcript_url: z.string().optional(),
  customProperties: CustomPropertiesSchema.optional(),
  source_event_id: z.string().optional(),
  originalTimestamp: z.string().optional(),
  raw_event: z.unknown().optional(),
})

export type TranscriptAvailableEvent = z.infer<typeof TranscriptAvailableEventSchema>

export const CallCompletedEventSchema = z.object({
  event_type: z.literal("call_completed"),
  regal_task_id: z.string().min(1),
  agent_email: z.string().optional(),
  contact_phone: z.string().optional(),
  sfdc_lead_id: z.string().optional(),
  disposition: z.string().optional(),
  campaign_name: z.string().optional(),
  campaign_friendly_id: z.string().optional(),
  conversation_happened: RegalBooleanSchema.optional(),
  talk_time: z.coerce.number().nonnegative().optional(),
  wrapup_time: z.coerce.number().nonnegative().optional(),
  handle_time: z.coerce.number().nonnegative().optional(),
  recording_duration: z.coerce.number().nonnegative().optional(),
  started_at: z.union([z.string(), z.number()]).optional(),
  ended_at: z.union([z.string(), z.number()]).optional(),
  completed_at: z.union([z.string(), z.number()]).optional(),
  customProperties: CustomPropertiesSchema.optional(),
  source_event_id: z.string().optional(),
  originalTimestamp: z.string().optional(),
  raw_event: z.unknown().optional(),
})

export type CallCompletedEvent = z.infer<typeof CallCompletedEventSchema>
