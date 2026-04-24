import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const programExpectationsRoutes = createEvalRoutes({
  endpoint: "program-expectations",
  moduleName: MODULE_NAMES.PROGRAM_EXPECTATIONS,
})
