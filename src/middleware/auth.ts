import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../types/env"

export const auth: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const authHeader = c.req.header("Authorization")

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401)
  }

  const token = authHeader.slice(7)
  if (token !== c.env.INTERNAL_API_KEY) {
    return c.json({ error: "Invalid API key" }, 401)
  }

  await next()
}
