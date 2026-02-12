import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { auth } from "./auth"
import type { AppEnv } from "../types/env"

function createApp() {
  const app = new Hono<AppEnv>()
  app.use("*", auth)
  app.get("/test", (c) => c.json({ ok: true }))
  return app
}

const TEST_API_KEY = "test-api-key-12345"

function createEnv() {
  return {
    ENVIRONMENT: "test",
    OPENROUTER_MODEL: "test-model",
    INTERNAL_API_KEY: TEST_API_KEY,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    CF_ACCOUNT_ID: "test-account",
    CF_GATEWAY_ID: "test-gateway",
    CF_AIG_TOKEN: "test-token",
  }
}

describe("auth middleware", () => {
  it("rejects missing Authorization header", async () => {
    const app = createApp()
    const res = await app.request("/test", {}, createEnv())
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe("Missing or invalid Authorization header")
  })

  it("rejects non-Bearer tokens", async () => {
    const app = createApp()
    const res = await app.request(
      "/test",
      { headers: { Authorization: "Basic abc123" } },
      createEnv(),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe("Missing or invalid Authorization header")
  })

  it("rejects invalid API keys", async () => {
    const app = createApp()
    const res = await app.request(
      "/test",
      { headers: { Authorization: "Bearer wrong-key" } },
      createEnv(),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe("Invalid API key")
  })

  it("accepts valid API key", async () => {
    const app = createApp()
    const res = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
      createEnv(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})
