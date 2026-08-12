import { vi } from "vitest"
import type { Bindings } from "../../src/types/env"

export const TEST_API_KEY = "test-api-key-12345"

function createWorkflowBinding(): Workflow {
  return { create: vi.fn(), createBatch: vi.fn(), get: vi.fn() }
}

export function createEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ENVIRONMENT: "test",
    OPENROUTER_MODEL: "test-model",
    INTERNAL_API_KEY: TEST_API_KEY,
    SKYFALL_PROFILE_RECAP_AUTH_KEY: "test-skyfall-profile-recap-key-32chars",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    CF_ACCOUNT_ID: "test-account",
    CF_GATEWAY_ID: "test-gateway",
    CF_AIG_TOKEN: "test-token",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/workflows/test",
    SLACK_WEBHOOK_URL_FULL_QA: "https://hooks.slack.com/workflows/test-full-qa",
    SLACK_WEBHOOK_URL_JOEL_NELSON: "https://hooks.slack.com/workflows/test-joel-nelson",
    SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON: "https://hooks.slack.com/workflows/test-full-qa-joel-nelson",
    DEEPGRAM_API_KEY: "test-deepgram-key",
    DEEPGRAM_MODEL: "nova-3",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    EVALUATION_WORKFLOW: createWorkflowBinding(),
    ACHIEVE_BACKFILL_CANARY_WORKFLOW: createWorkflowBinding(),
    ACHIEVE_BACKFILL_REMAINING56_WORKFLOW: createWorkflowBinding(),
    ...overrides,
  }
}
