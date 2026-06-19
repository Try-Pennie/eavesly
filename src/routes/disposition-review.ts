import { MODULE_NAMES } from "../modules/constants"
import { createEvalRoutes } from "./create-eval-routes"

export const dispositionReviewRoutes = createEvalRoutes({
  endpoint: "disposition-review",
  moduleName: MODULE_NAMES.DISPOSITION_REVIEW,
})
