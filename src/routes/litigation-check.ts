import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const litigationCheckRoutes = createEvalRoutes({
  endpoint: "litigation-check",
  moduleName: MODULE_NAMES.LITIGATION_CHECK,
})
