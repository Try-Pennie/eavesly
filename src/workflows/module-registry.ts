import { budgetInputsModule } from "../modules/budget-inputs/module"
import { MODULE_NAMES } from "../modules/constants"
import type { EvalModule } from "../modules/types"

const REGISTRY: Record<string, EvalModule> = {
  [MODULE_NAMES.BUDGET_INPUTS]: budgetInputsModule,
}

export function getModule(name: string): EvalModule {
  const mod = REGISTRY[name]
  if (!mod) throw new Error(`Unknown module: ${name}`)
  return mod
}
