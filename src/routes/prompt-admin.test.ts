import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

const upsertModulePrompt = vi.fn()

vi.mock("../services/database", () => ({
  DatabaseService: class {
    upsertModulePrompt = upsertModulePrompt
  },
}))

import { promptAdminRoutes } from "./prompt-admin"
import { MODULE_PROMPTS } from "../services/prompt-sync"

function app() {
  const a = new Hono<AppEnv>()
  a.route("/api/v1", promptAdminRoutes)
  return a
}

function post(auth = true) {
  return app().request(
    "/api/v1/admin/prompts/sync",
    {
      method: "POST",
      headers: { ...(auth ? { Authorization: `Bearer ${TEST_API_KEY}` } : {}) },
    },
    createEnv(),
  )
}

describe("Prompt admin sync route", () => {
  beforeEach(() => {
    upsertModulePrompt.mockReset().mockResolvedValue(true)
  })

  it("returns 401 without auth", async () => {
    const res = await post(false)
    expect(res.status).toBe(401)
    expect(upsertModulePrompt).not.toHaveBeenCalled()
  })

  it("syncs every mapped module and returns name/hash/changed only (no prompt text)", async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const raw = await res.text()
    const json = JSON.parse(raw) as any

    expect(json.synced).toHaveLength(Object.keys(MODULE_PROMPTS).length)
    expect(upsertModulePrompt).toHaveBeenCalledTimes(Object.keys(MODULE_PROMPTS).length)
    for (const entry of json.synced) {
      expect(entry.content_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof entry.changed).toBe("boolean")
      expect(entry.prompt_text).toBeUndefined()
    }
    // No prompt body leaks into the response.
    expect(raw).not.toContain(MODULE_PROMPTS["full_qa"].slice(0, 40))
  })
})
