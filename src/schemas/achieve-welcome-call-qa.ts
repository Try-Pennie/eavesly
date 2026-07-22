import { z } from "zod"

export const AchieveWelcomeCallQASchema = z.object({
  // partner_id and script_version are stamped here because eavesly_module_results
  // has no partner_id column. They live in result_json for observability/querying.
  partner_id: z.literal("achieve"),
  script_version: z.string(),

  script_adherence: z.object({
    greeting_and_identity_completed: z.boolean(),
    recording_disclosure_provided: z.boolean(),
    company_credibility_covered: z.boolean(),
    call_agenda_provided: z.boolean(),
    dedicated_account_deposits_explained: z.boolean(),
    creditor_negotiation_explained: z.boolean(),
    settlement_authorizations_explained: z.boolean(),
    dashboard_account_setup_covered: z.boolean(),
    tools_and_resources_covered: z.boolean(),
    closing_and_support_provided: z.boolean(),

    overall_script_adherence: z.enum(["full", "substantial", "partial", "minimal", "none"]),

    missing_elements: z.array(z.string()),
    key_evidence_quotes: z.array(z.string()),

    violation: z.boolean(),
    violation_reason: z.string(),
  }),

  agent_identity_check: z.object({
    correctly_identified_as_fdr: z.boolean(),
    issue_quote: z.string().nullable(),
  }),

  call_overview: z.object({
    call_outcome: z.string(),
    agent_tone: z.enum(["professional", "neutral", "unprofessional"]),
    client_engagement: z.enum(["engaged", "neutral", "disengaged"]),
    delivery_naturalness: z.enum(["natural", "scripted", "robotic"]),
    handoff_quality: z.enum(["smooth", "delayed", "silent"]),
    notes: z.string(),
  }),

  // How confident the LLM is in its own assessment of the extracted segment.
  // Lowered when the segment is ambiguous, too short, speaker attribution is
  // unclear, or required elements could only be inferred from outside the segment.
  assessment_confidence: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["high", "medium", "low"]),
    rationale: z.string(),
    limitations: z.array(z.string()),
  }),

  // Deterministic transfer-quality metadata, stamped by the module (not the LLM).
  transfer_experience: z.object({
    poor_transfer: z.boolean(),
    reasons: z.array(z.enum(["live_rep_then_ivr_reentry_then_live_rep", "dead_air_handoff", "ghost_pickup", "multi_attempt_no_ivr"])),
    ivr_reentry_lines: z.array(z.number().int().nonnegative()),
    agent_attempts: z.array(z.object({
      line: z.number().int().nonnegative(),
      name_asr: z.string().nullable(),
      quote: z.string(),
    })),
    evidence: z.array(z.object({
      line: z.number().int().nonnegative(),
      quote: z.string(),
    })),
    detection_version: z.literal("achieve_poor_transfer_v1"),
  }),

  // Deterministic segmentation metadata, stamped by the module (not the LLM).
  transcript_segment: z.object({
    segment_type: z.string(),
    start_line: z.number(),
    end_line: z.number(),
    marker: z.string().nullable(),
    segmentation_confidence: z.enum(["high", "medium", "low"]),
    segmentation_score: z.number().min(0).max(1),
    used_full_transcript_fallback: z.boolean(),
    segment_found: z.boolean(),
    skip_reason: z.string().nullable(),
    transfer_agent_lines: z.number(),
  }),
})
