import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv, Bindings } from "../types/env"
import { profileRecapAuth } from "../middleware/profile-recap-auth"
import { ProfileRecapRequestSchema } from "../schemas/profile-recap"
import {
  createSupabaseProfileRecaps,
  type ProfileRecaps,
  type ProfileRecapLookupResult,
} from "../services/profile-recap"
import { log } from "../utils/logger"

type CreateProfileRecaps = (env: Bindings) => ProfileRecaps

/** Build the narrowly authenticated Skyfall profile recap routes. */
export function createProfileRecapRoutes(
  createProfileRecaps: CreateProfileRecaps = createSupabaseProfileRecaps,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.post(
    "/profile-recap",
    profileRecapAuth,
    bodyLimit({
      maxSize: 1_024,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const contentType = c.req.header("Content-Type")
      const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
      if (mediaType !== "application/json") {
        return c.json({ error: "Content-Type must be application/json" }, 415)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.name === "BodyLimitError") {
          return c.json({ error: "Request body too large" }, 413)
        }
        return c.json({ error: "Invalid request" }, 400)
      }

      const request = ProfileRecapRequestSchema.safeParse(body)
      if (!request.success) {
        return c.json({ error: "Invalid request" }, 400)
      }

      let result: ProfileRecapLookupResult
      try {
        result = await createProfileRecaps(c.env).getBySalesforceLeadId(
          request.data.p_sfdc_lead_id,
        )
      } catch {
        log("error", "Profile recap lookup failed", {
          correlationId: c.get("correlationId"),
          errorTag: "unexpected_adapter_failure",
        })
        return c.json({ error: "Profile recap unavailable" }, 502)
      }

      if (result._tag === "failure") {
        log("error", "Profile recap lookup failed", {
          correlationId: c.get("correlationId"),
          errorTag: result.reason,
        })
        return c.json({ error: "Profile recap unavailable" }, 502)
      }

      c.header("Cache-Control", "no-store")
      return c.json(result.recap)
    },
  )

  return routes
}
