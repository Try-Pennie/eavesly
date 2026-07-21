import { MODULE_NAMES } from "../modules/constants"
import type { DatabaseService } from "./database"

// Build-time imports of the deployed prompt text (see the [[rules]] Text glob in
// wrangler.toml). These are the exact strings the modules run against, so the
// mirror can never drift from what's deployed.
import fullQaPrompt from "../../prompts/full-qa.txt"
import budgetInputsPrompt from "../../prompts/budget-inputs.txt"
import warmTransferPrompt from "../../prompts/warm-transfer.txt"
import litigationCheckPrompt from "../../prompts/litigation-check.txt"
import programExpectationsPrompt from "../../prompts/program-expectations.txt"
import activeSettlementsPrompt from "../../prompts/active-settlements.txt"
import dispositionReviewPrompt from "../../prompts/disposition-review.txt"
import achieveWelcomeCallQaPrompt from "../../prompts/achieve-welcome-call-qa.txt"
import gotaCheckPrompt from "../../prompts/gota-check.txt"

/**
 * Every canonical module name → its deployed prompt text. Keyed by MODULE_NAMES
 * so a new module added to constants.ts without a mapped prompt fails the unit
 * test (see prompt-sync.test.ts) rather than silently syncing an incomplete set.
 */
export const MODULE_PROMPTS: Record<string, string> = {
  [MODULE_NAMES.FULL_QA]: fullQaPrompt,
  [MODULE_NAMES.BUDGET_INPUTS]: budgetInputsPrompt,
  [MODULE_NAMES.WARM_TRANSFER]: warmTransferPrompt,
  [MODULE_NAMES.LITIGATION_CHECK]: litigationCheckPrompt,
  [MODULE_NAMES.PROGRAM_EXPECTATIONS]: programExpectationsPrompt,
  [MODULE_NAMES.ACTIVE_SETTLEMENTS]: activeSettlementsPrompt,
  [MODULE_NAMES.DISPOSITION_REVIEW]: dispositionReviewPrompt,
  [MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA]: achieveWelcomeCallQaPrompt,
  [MODULE_NAMES.GOTA_CHECK]: gotaCheckPrompt,
}

export interface PromptSyncResult {
  module_name: string
  content_hash: string
  /** True when the deployed hash differed from the stored one (deployed_at bumped). */
  changed: boolean
}

/** SHA-256 hex of the prompt text via WebCrypto (available in Workers). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Mirror every bundled module prompt into eavesly_module_prompts so QVV can
 * render them read-only. Upserts on module_name; deployed_at is only bumped when
 * the content hash changed, so the timestamp means "last change deployed".
 * Returns name/hash/changed only — never the prompt text itself.
 */
export async function syncModulePrompts(db: DatabaseService): Promise<PromptSyncResult[]> {
  const results: PromptSyncResult[] = []
  for (const [moduleName, promptText] of Object.entries(MODULE_PROMPTS)) {
    const contentHash = await sha256Hex(promptText)
    const changed = await db.upsertModulePrompt({ moduleName, promptText, contentHash })
    results.push({ module_name: moduleName, content_hash: contentHash, changed })
  }
  return results
}
