import type { Bindings } from "../../src/types/env"

export const TEST_API_KEY = "test-api-key-12345"

export function createEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ENVIRONMENT: "test",
    OPENROUTER_MODEL: "test-model",
    INTERNAL_API_KEY: TEST_API_KEY,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    CF_ACCOUNT_ID: "test-account",
    CF_GATEWAY_ID: "test-gateway",
    CF_AIG_TOKEN: "test-token",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/workflows/test",
    ...overrides,
  }
}
