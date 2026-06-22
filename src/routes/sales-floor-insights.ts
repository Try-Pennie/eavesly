import { Hono } from "hono"
import type { Context } from "hono"
import type { AppEnv } from "../types/env"
import { auth } from "../middleware/auth"
import { DatabaseService } from "../services/database"
import { computeWindows, buildReport } from "../services/sales-floor-insights"
import { renderReportHtml } from "../services/sales-floor-insights-html"

const salesFloorInsightsRoutes = new Hono<AppEnv>()
salesFloorInsightsRoutes.use("*", auth)

function isClientInputError(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("Invalid ")
}

function errorResponse(c: Context<AppEnv>, e: unknown) {
  if (isClientInputError(e)) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  return c.json({ error: "Failed to build sales-floor insights report" }, 500)
}

/**
 * Shared builder. Query params (all optional, for deterministic runs):
 *   ?week_start=YYYY-MM-DD  explicit Mon-start of the reported week
 *   ?as_of=YYYY-MM-DD       compute the previous complete week relative to this date
 * Default: previous complete ISO week (UTC) relative to now.
 */
async function build(c: Context<AppEnv>) {
  const weekStart = c.req.query("week_start")
  const asOfStr = c.req.query("as_of")
  const asOf = asOfStr ? new Date(asOfStr) : undefined
  if (asOf && isNaN(asOf.getTime())) throw new Error(`Invalid as_of (expected YYYY-MM-DD): ${asOfStr}`)

  const windows = computeWindows({ weekStart, asOf })
  const db = new DatabaseService(c.env)
  const rows = await db.getSalesFloorRows(windows.range.start, windows.range.end)
  return buildReport(rows, windows, new Date().toISOString())
}

salesFloorInsightsRoutes.get("/reports/sales-floor-insights", async (c) => {
  try {
    return c.json(await build(c))
  } catch (e) {
    return errorResponse(c, e)
  }
})

salesFloorInsightsRoutes.get("/reports/sales-floor-insights.html", async (c) => {
  try {
    return c.html(renderReportHtml(await build(c)))
  } catch (e) {
    return errorResponse(c, e)
  }
})

export { salesFloorInsightsRoutes }
