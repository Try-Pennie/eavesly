import { Hono } from "hono"
import type { AppEnv } from "./types/env"
import { corsMiddleware } from "./middleware/cors"
import { requestLogger } from "./middleware/request-logger"
import { evaluateRoutes } from "./routes/evaluate"
import { batchRoutes } from "./routes/batch"
import { healthRoutes } from "./routes/health"

const app = new Hono<AppEnv>()

app.use("*", corsMiddleware())
app.use("*", requestLogger)

app.route("/", healthRoutes)
app.route("/api/v1", evaluateRoutes)
app.route("/api/v1", batchRoutes)

app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack)
  return c.json(
    { error: "Internal server error", message: err.message },
    500,
  )
})

export default app
