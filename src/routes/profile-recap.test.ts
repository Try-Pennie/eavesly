import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"
import { createProfileRecapRoutes } from "./profile-recap"
import {
  SalesforceLeadIdSchema,
  type SalesforceLeadId,
} from "../schemas/profile-recap"
import type { ProfileRecapLookupResult } from "../services/profile-recap"

const TEST_PROFILE_RECAP_AUTH_KEY = "test-skyfall-profile-recap-key-32chars"

function createApp(
  getBySalesforceLeadId: (
    leadId: SalesforceLeadId,
  ) => Promise<ProfileRecapLookupResult> = async () => {
    throw new Error("Profile recap adapter must not be called")
  },
) {
  const app = new Hono<AppEnv>()
  app.route(
    "/api/v1",
    createProfileRecapRoutes(() => ({ getBySalesforceLeadId })),
  )
  return app
}

describe("profile recap route", () => {
  it("rejects a request without authorization", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("rejects an incorrect bearer without revealing credential details", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer")
  })

  it("rejects the global INTERNAL_API_KEY for this route", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("does not accept the legacy apiKey header as authorization", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          apiKey: TEST_PROFILE_RECAP_AUTH_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("fails closed when the dedicated credential is not configured", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: undefined }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Service unavailable" })
  })

  it("fails closed when the configured credential is shorter than 32 characters", async () => {
    const shortCredential = "too-short"
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${shortCredential}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: shortCredential }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Service unavailable" })
  })

  it("rejects a non-JSON content type", async () => {
    const leadId = SalesforceLeadIdSchema.parse("00Q123456789ABCDEF")
    const response = await createApp(async () => ({
      _tag: "success",
      recap: { lead_id: leadId, total_calls: 0, timeline: [] },
    })).request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({ p_sfdc_lead_id: leadId }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      error: "Content-Type must be application/json",
    })
  })

  it("rejects a request body larger than one KiB", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_sfdc_lead_id: "00Q123456789ABCDEF",
          padding: "x".repeat(2_000),
        }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "Request body too large" })
  })

  it("returns a generic validation error for malformed JSON", async () => {
    const response = await createApp().request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{not-json",
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid request" })
  })

  it("returns a generic 502 when the route adapter unexpectedly throws", async () => {
    const response = await createApp(async () => {
      throw new Error("sensitive adapter detail")
    }).request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "Profile recap unavailable" })
  })

  it("returns a generic error when the profile recap dependency fails", async () => {
    const response = await createApp(async () => ({
      _tag: "failure",
      reason: "rpc_error",
    })).request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: "00Q123456789ABCDEF" }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "Profile recap unavailable" })
  })

  it("returns the compatible recap JSON for a valid request", async () => {
    const leadId = SalesforceLeadIdSchema.parse("00Q123456789ABCDEF")
    const recap = {
      lead_id: leadId,
      total_calls: 1,
      timeline: [
        {
          call_id: "call-1",
          timestamp: "2026-07-17T08:00:00+00:00",
          date: "07/17/2026",
          time: "08:00:00 AM",
          duration_minutes: 4,
          agent: "Agent Example",
          disposition: "Interested",
          campaign: null,
          direction: "OUTBOUND",
          summary: "Lead requested a follow-up.",
          notes: null,
        },
      ],
    }
    const requestedLeadIds: string[] = []
    const response = await createApp(async (requestedLeadId) => {
      requestedLeadIds.push(requestedLeadId)
      return { _tag: "success", recap }
    }).request(
      "/api/v1/profile-recap",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_PROFILE_RECAP_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_sfdc_lead_id: leadId }),
      },
      createEnv({ SKYFALL_PROFILE_RECAP_AUTH_KEY: TEST_PROFILE_RECAP_AUTH_KEY }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(recap)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(requestedLeadIds).toEqual([leadId])
  })
})
