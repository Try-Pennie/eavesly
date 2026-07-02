import { describe, it, expect, vi } from "vitest"
import { MODULE_PROMPTS, syncModulePrompts, sha256Hex } from "./prompt-sync"
import { MODULE_NAMES } from "../modules/constants"

describe("MODULE_PROMPTS", () => {
  it("maps every MODULE_NAMES entry to a non-empty prompt", () => {
    for (const moduleName of Object.values(MODULE_NAMES)) {
      expect(MODULE_PROMPTS[moduleName], `missing prompt for module '${moduleName}'`).toBeTruthy()
      expect(typeof MODULE_PROMPTS[moduleName]).toBe("string")
      expect(MODULE_PROMPTS[moduleName].length).toBeGreaterThan(0)
    }
  })

  it("does not map any module name that isn't in MODULE_NAMES", () => {
    const known = new Set<string>(Object.values(MODULE_NAMES))
    for (const key of Object.keys(MODULE_PROMPTS)) {
      expect(known.has(key), `unexpected prompt key '${key}'`).toBe(true)
    }
  })
})

describe("sha256Hex", () => {
  it("produces a stable 64-char lowercase hex digest", async () => {
    const hash = await sha256Hex("hello")
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })
})

describe("syncModulePrompts", () => {
  it("upserts every mapped prompt and reports name/hash/changed only", async () => {
    const upsertModulePrompt = vi.fn().mockResolvedValue(true)
    const db = { upsertModulePrompt } as any

    const results = await syncModulePrompts(db)

    expect(upsertModulePrompt).toHaveBeenCalledTimes(Object.keys(MODULE_PROMPTS).length)
    expect(new Set(results.map((r) => r.module_name))).toEqual(
      new Set(Object.keys(MODULE_PROMPTS)),
    )
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(["changed", "content_hash", "module_name"])
      expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(r.changed).toBe(true)
    }
    // Never leaks prompt text.
    expect(JSON.stringify(results)).not.toContain(MODULE_PROMPTS[MODULE_NAMES.FULL_QA].slice(0, 40))
  })

  it("reports changed=false for prompts whose hash was unchanged", async () => {
    const upsertModulePrompt = vi.fn().mockResolvedValue(false)
    const db = { upsertModulePrompt } as any
    const results = await syncModulePrompts(db)
    expect(results.every((r) => r.changed === false)).toBe(true)
  })
})
