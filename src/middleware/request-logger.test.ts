import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { requestLogger } from "./request-logger"

function createApp() {
  const app = new Hono<AppEnv>()
  app.use("*", requestLogger)
  app.get("/test", (c) => {
    return c.json({ correlationId: c.get("correlationId") })
  })
  return app
}

describe("requestLogger middleware", () => {
  it("generates correlation ID when none provided", async () => {
    const app = createApp()
    const res = await app.request("/test")
    const id = res.headers.get("X-Correlation-ID")
    expect(id).toBeTruthy()
    expect(typeof id).toBe("string")
  })

  it("uses provided X-Correlation-ID header", async () => {
    const app = createApp()
    const res = await app.request("/test", {
      headers: { "X-Correlation-ID": "my-custom-id" },
    })
    expect(res.headers.get("X-Correlation-ID")).toBe("my-custom-id")
  })

  it("makes correlation ID available in context", async () => {
    const app = createApp()
    const res = await app.request("/test", {
      headers: { "X-Correlation-ID": "ctx-test-id" },
    })
    const body = (await res.json()) as { correlationId: string }
    expect(body.correlationId).toBe("ctx-test-id")
  })
})
