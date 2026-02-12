import { Hono } from "hono"
import type { AppEnv } from "./types/env"
import { corsMiddleware } from "./middleware/cors"
import { requestLogger } from "./middleware/request-logger"
import { fullQARoutes } from "./routes/full-qa"
import { budgetInputsRoutes } from "./routes/budget-inputs"
import { warmTransferRoutes } from "./routes/warm-transfer"
import { healthRoutes } from "./routes/health"

const app = new Hono<AppEnv>()

app.use("*", corsMiddleware())
app.use("*", requestLogger)

app.route("/", healthRoutes)
app.route("/api/v1", fullQARoutes)
app.route("/api/v1", budgetInputsRoutes)
app.route("/api/v1", warmTransferRoutes)

app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack)
  return c.json(
    { error: "Internal server error", message: err.message },
    500,
  )
})

export default app
