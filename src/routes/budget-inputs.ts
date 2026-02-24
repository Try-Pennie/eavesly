import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const budgetInputsRoutes = createEvalRoutes({
  endpoint: "budget-inputs",
  moduleName: MODULE_NAMES.BUDGET_INPUTS,
})
