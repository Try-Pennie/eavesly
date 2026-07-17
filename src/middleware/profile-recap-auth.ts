import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../types/env"

const BEARER_TOKEN_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i
const MINIMUM_CREDENTIAL_LENGTH = 32
const encoder = new TextEncoder()

async function credentialsMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ])

  return crypto.subtle.timingSafeEqual(candidateDigest, expectedDigest)
}

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Response {
  c.header("WWW-Authenticate", "Bearer")
  return c.json({ error: "Unauthorized" }, 401)
}

/** Authenticate the Skyfall-only profile recap credential without exposing it downstream. */
export const profileRecapAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header("Cache-Control", "no-store")

  const expectedCredential = c.env.SKYFALL_PROFILE_RECAP_AUTH_KEY
  if (
    expectedCredential === undefined ||
    expectedCredential.length < MINIMUM_CREDENTIAL_LENGTH
  ) {
    return c.json({ error: "Service unavailable" }, 503)
  }

  const authorization = c.req.header("Authorization")
  const match = authorization === undefined ? null : BEARER_TOKEN_PATTERN.exec(authorization)
  if (match === null) {
    return unauthorized(c)
  }

  const candidateCredential = match[1]
  if (!(await credentialsMatch(candidateCredential, expectedCredential))) {
    return unauthorized(c)
  }

  await next()
}
