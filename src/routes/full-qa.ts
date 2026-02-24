import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const fullQARoutes = createEvalRoutes({
  endpoint: "full-qa",
  moduleName: MODULE_NAMES.FULL_QA,
})
