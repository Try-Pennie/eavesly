import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const achieveWelcomeCallQARoutes = createEvalRoutes({
  endpoint: "achieve-welcome-call-qa",
  moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
  requiredPartnerId: "achieve",
})
