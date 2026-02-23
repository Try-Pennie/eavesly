import { Hono } from "hono"
import type { AppEnv } from "./types/env"
import { corsMiddleware } from "./middleware/cors"
import { requestLogger } from "./middleware/request-logger"
import { validateEnv } from "./utils/validate-env"
import { log } from "./utils/logger"
import { fullQARoutes } from "./routes/full-qa"
import { budgetInputsRoutes } from "./routes/budget-inputs"
import { warmTransferRoutes } from "./routes/warm-transfer"
import { litigationCheckRoutes } from "./routes/litigation-check"
import { healthRoutes } from "./routes/health"
import { statusRoutes } from "./routes/status"

const app = new Hono<AppEnv>()

app.use("*", corsMiddleware())
app.use("*", requestLogger)
app.use("*", async (c, next) => {
  validateEnv(c.env)
  await next()
})

app.route("/", healthRoutes)
app.route("/api/v1", fullQARoutes)
app.route("/api/v1", budgetInputsRoutes)
app.route("/api/v1", warmTransferRoutes)
app.route("/api/v1", litigationCheckRoutes)
app.route("/api/v1", statusRoutes)

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
