import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { corsMiddleware } from "./cors"

function createApp() {
  const app = new Hono()
  app.use("*", corsMiddleware())
  app.get("/test", (c) => c.json({ ok: true }))
  return app
}

describe("CORS middleware", () => {
  it("sets Access-Control-Allow-Origin header", async () => {
    const app = createApp()
    const res = await app.request("/test")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  it("handles OPTIONS preflight request", async () => {
    const app = createApp()
    const res = await app.request("/test", { method: "OPTIONS" })
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET")
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST")
  })

  it("includes Authorization in allowed headers", async () => {
    const app = createApp()
    const res = await app.request("/test", { method: "OPTIONS" })
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
  })

  it("includes Content-Type in allowed headers", async () => {
    const app = createApp()
    const res = await app.request("/test", { method: "OPTIONS" })
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type")
  })
})
