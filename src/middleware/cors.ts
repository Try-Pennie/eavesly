import { cors as honoCors } from "hono/cors"
import type { Bindings } from "../types/env"

export function corsMiddleware() {
  return honoCors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
}
