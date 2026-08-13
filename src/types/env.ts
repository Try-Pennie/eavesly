export interface Bindings {
  ENVIRONMENT: string
  OPENROUTER_MODEL: string
  /** Optional per-module override; disposition-review uses this when set, else OPENROUTER_MODEL. */
  DISPOSITION_REVIEW_MODEL?: string
  INTERNAL_API_KEY: string
  /** Server-owned allowlist digest for the one approved 17-call Achieve QA recovery artifact. */
  ACHIEVE_QA_RECOVERY_APPROVED_DIGEST?: string
  /** Dedicated 32+ character server-to-server credential for the Skyfall profile recap endpoint. */
  SKYFALL_PROFILE_RECAP_AUTH_KEY?: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  CF_ACCOUNT_ID: string
  CF_GATEWAY_ID: string
  CF_AIG_TOKEN: string
  SLACK_WEBHOOK_URL?: string
  SLACK_WEBHOOK_URL_FULL_QA?: string
  SLACK_WEBHOOK_URL_JOEL_NELSON?: string
  SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON?: string
  DASHBOARD_BASE_URL?: string
  DEEPGRAM_API_KEY?: string
  DEEPGRAM_MODEL?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  EVALUATION_WORKFLOW: Workflow
  /** Dedicated deterministic PSAI-245 one-call canary Workflow binding. */
  ACHIEVE_BACKFILL_CANARY_WORKFLOW: Workflow
  /** Separately gated deterministic PSAI-245 remaining-56 Workflow binding. */
  ACHIEVE_BACKFILL_REMAINING56_WORKFLOW: Workflow
  /** Forward-only deterministic PSAI-245 resume of pending ordinals after 30. */
  ACHIEVE_BACKFILL_RESUME27_WORKFLOW: Workflow
  /** Dedicated, digest-bound, no-alert recovery for ordinary Achieve QA gaps. */
  ACHIEVE_QA_RECOVERY_WORKFLOW: Workflow
}

export interface Variables {
  correlationId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
