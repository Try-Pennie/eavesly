export interface Bindings {
  ENVIRONMENT: string
  OPENROUTER_MODEL: string
  INTERNAL_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  CF_ACCOUNT_ID: string
  CF_GATEWAY_ID: string
  CF_AIG_TOKEN: string
  SLACK_WEBHOOK_URL?: string
}

export interface Variables {
  correlationId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
