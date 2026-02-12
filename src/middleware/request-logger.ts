import type { MiddlewareHandler } from "hono"
import { log } from "../utils/logger"

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const correlationId =
    c.req.header("X-Correlation-ID") ?? crypto.randomUUID()
  const start = Date.now()

  c.set("correlationId", correlationId)
  c.header("X-Correlation-ID", correlationId)

  await next()

  const duration = Date.now() - start
  log("info", "Request completed", {
    correlationId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: duration,
  })
}
