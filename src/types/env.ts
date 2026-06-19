export interface Bindings {
  ENVIRONMENT: string
  OPENROUTER_MODEL: string
  /** Optional per-module override; disposition-review uses this when set, else OPENROUTER_MODEL. */
  DISPOSITION_REVIEW_MODEL?: string
  INTERNAL_API_KEY: string
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
}

export interface Variables {
  correlationId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
