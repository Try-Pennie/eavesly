import type { Bindings } from "../types/env"

const REQUIRED_KEYS: (keyof Bindings)[] = [
  "ENVIRONMENT",
  "OPENROUTER_MODEL",
  "INTERNAL_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CF_ACCOUNT_ID",
  "CF_GATEWAY_ID",
  "CF_AIG_TOKEN",
]

export function validateEnv(env: Bindings): void {
  const missing = REQUIRED_KEYS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`)
  }
}
