import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { DatabaseService } from "../services/database"
import { syncModulePrompts } from "../services/prompt-sync"
import { auth } from "../middleware/auth"

/**
 * Prompt mirror admin (PSAI-202).
 *
 * POST /api/v1/admin/prompts/sync writes the bundled module prompt text into
 * eavesly_module_prompts so QVV can render the prompts read-only. Prompt editing
 * stays in this repo (the .txt files); this endpoint only mirrors what's
 * deployed. Call it once after each deploy, or whenever a prompt changes.
 *
 * No request body. Behind the same INTERNAL_API_KEY auth as the other internal
 * routes. The response is name/hash/changed only — it never returns prompt text.
 */

const promptAdminRoutes = new Hono<AppEnv>()
promptAdminRoutes.use("*", auth)

promptAdminRoutes.post("/admin/prompts/sync", async (c) => {
  const db = new DatabaseService(c.env)
  const synced = await syncModulePrompts(db)
  return c.json({ synced })
})

export { promptAdminRoutes }
