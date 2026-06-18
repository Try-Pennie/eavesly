import { budgetInputsModule } from "../modules/budget-inputs/module"
import { fullQAModule } from "../modules/full-qa/module"
import { warmTransferModule } from "../modules/warm-transfer/module"
import { litigationCheckModule } from "../modules/litigation-check/module"
import { programExpectationsModule } from "../modules/program-expectations/module"
import { activeSettlementsModule } from "../modules/active-settlements/module"
import { dispositionReviewModule } from "../modules/disposition-review/module"
import { MODULE_NAMES } from "../modules/constants"
import type { EvalModule } from "../modules/types"

const REGISTRY: Record<string, EvalModule> = {
  [MODULE_NAMES.BUDGET_INPUTS]: budgetInputsModule,
  [MODULE_NAMES.FULL_QA]: fullQAModule,
  [MODULE_NAMES.WARM_TRANSFER]: warmTransferModule,
  [MODULE_NAMES.LITIGATION_CHECK]: litigationCheckModule,
  [MODULE_NAMES.PROGRAM_EXPECTATIONS]: programExpectationsModule,
  [MODULE_NAMES.ACTIVE_SETTLEMENTS]: activeSettlementsModule,
  [MODULE_NAMES.DISPOSITION_REVIEW]: dispositionReviewModule,
}

export function getModule(name: string): EvalModule {
  const mod = REGISTRY[name]
  if (!mod) throw new Error(`Unknown module: ${name}`)
  return mod
}
