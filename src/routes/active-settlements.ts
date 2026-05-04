import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const activeSettlementsRoutes = createEvalRoutes({
  endpoint: "active-settlements",
  moduleName: MODULE_NAMES.ACTIVE_SETTLEMENTS,
})
