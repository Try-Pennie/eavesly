import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../types/env"

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  return crypto.subtle.timingSafeEqual(bufA, bufB)
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization")

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401)
  }

  const token = authHeader.slice(7)
  if (!timingSafeEqual(token, c.env.INTERNAL_API_KEY)) {
    return c.json({ error: "Invalid API key" }, 401)
  }

  await next()
}
