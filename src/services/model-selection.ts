import type { Bindings } from "../types/env"
import { MODULE_NAMES } from "../modules/constants"
import type { EvaluationExecution } from "../schemas/evaluation-execution"

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

/**
 * Backfill retries may opt into the primary model when a module-specific model
 * repeatedly returns an unusable provider response. Live traffic and ordinary
 * backfills retain normal per-module model selection.
 */
export function modelForEvaluation(
  env: Bindings,
  moduleName: string,
  execution: EvaluationExecution,
): string | undefined {
  if (execution.mode === "backfill" && execution.model_strategy === "primary") {
    return env.OPENROUTER_MODEL
  }
  return modelForModule(env, moduleName)
}
