import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { createEnv, TEST_API_KEY } from "../../test/helpers/mock-env"

const emptyRows = { calls: [], qa: [], modules: [] }
const getSalesFloorRows = vi.fn().mockResolvedValue(emptyRows)

vi.mock("../services/database", () => ({
  DatabaseService: class {
    getSalesFloorRows = getSalesFloorRows
  },
}))

import { salesFloorInsightsRoutes } from "./sales-floor-insights"
import { renderReportHtml } from "../services/sales-floor-insights-html"
import { buildReport, computeWindows } from "../services/sales-floor-insights"

function createApp() {
  const app = new Hono<AppEnv>()
  app.route("/api/v1", salesFloorInsightsRoutes)
  return app
}

const authed = { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }

describe("sales-floor-insights routes", () => {
  it("returns 401 without auth (JSON)", async () => {
    const res = await createApp().request("/api/v1/reports/sales-floor-insights", {}, createEnv())
    expect(res.status).toBe(401)
  })

  it("returns 401 without auth (HTML)", async () => {
    const res = await createApp().request("/api/v1/reports/sales-floor-insights.html", {}, createEnv())
    expect(res.status).toBe(401)
  })

  it("returns a JSON report with the expected shape", async () => {
    const res = await createApp().request(
      "/api/v1/reports/sales-floor-insights?week_start=2026-06-08",
      authed,
      createEnv(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.windows.current.start).toBe("2026-06-08T00:00:00.000Z")
    expect(body.current).toBeDefined()
    expect(Array.isArray(body.insights)).toBe(true)
    expect(Array.isArray(body.leaderboard)).toBe(true)
    expect(body.generated_at).toBeTruthy()
    // empty data still yields a valid report
    expect(body.current.callVolume).toBe(0)
    expect(getSalesFloorRows).toHaveBeenCalledWith(
      "2026-05-11T00:00:00.000Z",
      "2026-06-15T00:00:00.000Z",
    )
  })

  it("returns printable HTML", async () => {
    const res = await createApp().request(
      "/api/v1/reports/sales-floor-insights.html?week_start=2026-06-08",
      authed,
      createEnv(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("Sales Floor Insights")
    expect(html).toContain("@media print")
  })

  it("returns 400 on a malformed week_start", async () => {
    const res = await createApp().request(
      "/api/v1/reports/sales-floor-insights?week_start=last-monday",
      authed,
      createEnv(),
    )
    expect(res.status).toBe(400)
  })

  it("returns 500 with a generic message when the data fetch fails", async () => {
    getSalesFloorRows.mockRejectedValueOnce(new Error("relation eavesly_module_results does not exist"))
    const res = await createApp().request(
      "/api/v1/reports/sales-floor-insights?week_start=2026-06-08",
      authed,
      createEnv(),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as any
    expect(body.error).toBe("Failed to build sales-floor insights report")
  })

  it("escapes report values in printable HTML", () => {
    const report = buildReport({
      calls: [{ started_at: "2026-06-10T12:00:00.000Z", agent_email: "evil<script>@pennie.com", talk_time: 60, disposition: "<No Answer>", direction: "outbound" }],
      qa: [],
      modules: [],
    }, computeWindows({ weekStart: "2026-06-08" }))
    const html = renderReportHtml(report)
    expect(html).toContain("&lt;No Answer&gt;")
    expect(html).not.toContain("evil<script>")
  })
})
