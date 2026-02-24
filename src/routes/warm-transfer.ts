import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const warmTransferRoutes = createEvalRoutes({
  endpoint: "warm-transfer",
  moduleName: MODULE_NAMES.WARM_TRANSFER,
})
