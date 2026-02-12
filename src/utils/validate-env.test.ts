import { describe, it, expect } from "vitest"
import { validateEnv } from "./validate-env"
import { createEnv } from "../../test/helpers/mock-env"

describe("validateEnv", () => {
  it("passes when all env vars present", () => {
    expect(() => validateEnv(createEnv())).not.toThrow()
  })

  it("throws when INTERNAL_API_KEY is missing", () => {
    expect(() => validateEnv(createEnv({ INTERNAL_API_KEY: "" }))).toThrow(
      "Missing required env vars",
    )
    expect(() => validateEnv(createEnv({ INTERNAL_API_KEY: "" }))).toThrow(
      "INTERNAL_API_KEY",
    )
  })

  it("throws when SUPABASE_URL is missing", () => {
    expect(() => validateEnv(createEnv({ SUPABASE_URL: "" }))).toThrow(
      "SUPABASE_URL",
    )
  })

  it("throws when multiple vars are missing", () => {
    expect(() =>
      validateEnv(createEnv({ SUPABASE_URL: "", CF_AIG_TOKEN: "" })),
    ).toThrow("SUPABASE_URL")
  })

  it("lists all missing vars in error message", () => {
    try {
      validateEnv(createEnv({ SUPABASE_URL: "", CF_AIG_TOKEN: "" }))
      expect.unreachable("Should have thrown")
    } catch (e) {
      const message = (e as Error).message
      expect(message).toContain("SUPABASE_URL")
      expect(message).toContain("CF_AIG_TOKEN")
    }
  })

  it("throws when ENVIRONMENT is missing", () => {
    expect(() => validateEnv(createEnv({ ENVIRONMENT: "" }))).toThrow(
      "ENVIRONMENT",
    )
  })

  it("passes with non-empty values", () => {
    const env = createEnv({
      ENVIRONMENT: "production",
      OPENROUTER_MODEL: "gpt-4",
    })
    expect(() => validateEnv(env)).not.toThrow()
  })
})
