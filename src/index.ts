import { Hono } from "hono"
import type { AppEnv } from "./types/env"
import { requestLogger } from "./middleware/request-logger"
import { validateEnv } from "./utils/validate-env"
import { log } from "./utils/logger"
import { MODULE_NAMES } from "./modules/constants"
import { createEvalRoutes } from "./routes/create-eval-routes"
import { healthRoutes } from "./routes/health"
import { statusRoutes } from "./routes/status"
import { regalEventRoutes } from "./routes/regal-events"
import { regalAdminRoutes } from "./routes/regal-admin"
import { promptAdminRoutes } from "./routes/prompt-admin"
import { createProfileRecapRoutes } from "./routes/profile-recap"
import { createAchieveBackfillAdminRoutes } from "./routes/achieve-backfill-admin"

// Per-module evaluation endpoints. Each mounts /evaluate/<endpoint>,
// /evaluate/<endpoint>/batch, and /evaluate/<endpoint>/from-recording under /api/v1.
const EVAL_ROUTE_CONFIGS = [
  { endpoint: "full-qa", moduleName: MODULE_NAMES.FULL_QA },
  { endpoint: "budget-inputs", moduleName: MODULE_NAMES.BUDGET_INPUTS },
  { endpoint: "warm-transfer", moduleName: MODULE_NAMES.WARM_TRANSFER },
  { endpoint: "litigation-check", moduleName: MODULE_NAMES.LITIGATION_CHECK },
  { endpoint: "program-expectations", moduleName: MODULE_NAMES.PROGRAM_EXPECTATIONS },
  { endpoint: "active-settlements", moduleName: MODULE_NAMES.ACTIVE_SETTLEMENTS },
  { endpoint: "disposition-review", moduleName: MODULE_NAMES.DISPOSITION_REVIEW },
  {
    endpoint: "achieve-welcome-call-qa",
    moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
    requiredPartnerId: "achieve",
  },
  { endpoint: "gota-check", moduleName: MODULE_NAMES.GOTA_CHECK },
] as const

const app = new Hono<AppEnv>()

app.use("*", requestLogger)
app.use("*", async (c, next) => {
  validateEnv(c.env)
  await next()
})

app.route("/", healthRoutes)
// Mount before the existing /api/v1 routers, whose wildcard auth middleware
// otherwise handles every request under that prefix.
app.route("/api/v1", createProfileRecapRoutes())
for (const config of EVAL_ROUTE_CONFIGS) {
  app.route("/api/v1", createEvalRoutes(config))
}
app.route("/api/v1", statusRoutes)
app.route("/api/v1", regalEventRoutes)
app.route("/api/v1", regalAdminRoutes)
app.route("/api/v1", createAchieveBackfillAdminRoutes())
app.route("/api/v1", promptAdminRoutes)

app.onError((err, c) => {
  log("error", "Unhandled error", {
    correlationId: c.get("correlationId"),
    error: err.message,
    stack: err.stack,
  })
  return c.json(
    { error: "Internal server error", message: err.message },
    500,
  )
})

export default app
export { EvaluationWorkflow } from "./workflows/evaluation-workflow"
export { AchieveBackfillCanaryWorkflow } from "./workflows/achieve-backfill-canary-workflow"
