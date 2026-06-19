import type { Bindings } from "../types/env"
import { MODULE_NAMES } from "../modules/constants"

/**
 * Per-module LLM model override.
 *
 * Returns the model a given module should use, or `undefined` to fall back to
 * the global `OPENROUTER_MODEL`. This lets us run a cheaper model on
 * lower-stakes modules (e.g. the advisory disposition-review) without changing
 * the default the violation-detecting modules rely on. Selection is config
 * driven (env vars), so it's reversible per environment with no code change.
 */
export function modelForModule(
  env: Bindings,
  moduleName: string,
): string | undefined {
  if (moduleName === MODULE_NAMES.DISPOSITION_REVIEW) {
    return env.DISPOSITION_REVIEW_MODEL || undefined
  }
  return undefined
}
