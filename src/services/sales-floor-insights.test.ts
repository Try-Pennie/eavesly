import { describe, it, expect } from "vitest"
import {
  computeWindows,
  pctDelta,
  aggregate,
  buildReport,
  type CallRow,
  type QaRow,
  type ModuleRow,
  type SalesFloorRows,
} from "./sales-floor-insights"

// week_start 2026-06-08 is a Monday; current = 06-08..06-15, prior = 06-01..06-08.
const WEEK_START = "2026-06-08"
const inCurrent = "2026-06-10T12:00:00.000Z"
const inPrior = "2026-06-03T12:00:00.000Z"

function calls(n: number, agent: string, when: string, talk: number, disposition: string): CallRow[] {
  return Array.from({ length: n }, () => ({ started_at: when, agent_email: agent, talk_time: talk, disposition, direction: "outbound" }))
}
function qa(n: number, agent: string, when: string, o: Partial<QaRow>): QaRow[] {
  return Array.from({ length: n }, () => ({
    created_at: when,
    agent_email: agent,
    manager_email: o.manager_email ?? "mgr@pennie.com",
    overall_score: o.overall_score ?? "good",
    compliance_rating: o.compliance_rating ?? "pass",
    customer_satisfaction_likely: o.customer_satisfaction_likely ?? "high",
    manager_escalation: o.manager_escalation ?? false,
  }))
}
function modules(n: number, agent: string, when: string, violation: boolean): ModuleRow[] {
  return Array.from({ length: n }, () => ({ created_at: when, module_name: "disposition_review", has_violation: violation, agent_email: agent }))
}

const fixture: SalesFloorRows = {
  calls: [
    ...calls(6, "a@pennie.com", inCurrent, 100, "Sale"),
    ...calls(6, "b@pennie.com", inCurrent, 200, "No Answer"),
    ...calls(4, "a@pennie.com", inPrior, 100, "Sale"),
  ],
  qa: [
    ...qa(6, "a@pennie.com", inCurrent, { overall_score: "excellent", compliance_rating: "pass", customer_satisfaction_likely: "high", manager_escalation: false }),
    ...qa(6, "b@pennie.com", inCurrent, { overall_score: "poor", compliance_rating: "fail", customer_satisfaction_likely: "low", manager_escalation: true }),
    ...qa(4, "a@pennie.com", inPrior, { overall_score: "excellent", compliance_rating: "pass", customer_satisfaction_likely: "high", manager_escalation: false }),
  ],
  modules: [
    ...modules(6, "a@pennie.com", inCurrent, false),
    ...modules(6, "b@pennie.com", inCurrent, true),
    ...modules(4, "a@pennie.com", inPrior, false),
  ],
}

describe("computeWindows", () => {
  it("derives current/prior/baseline from an explicit Monday week_start", () => {
    const w = computeWindows({ weekStart: WEEK_START })
    expect(w.current).toEqual({ start: "2026-06-08T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" })
    expect(w.prior).toEqual({ start: "2026-06-01T00:00:00.000Z", end: "2026-06-08T00:00:00.000Z" })
    expect(w.baseline).toEqual({ start: "2026-05-11T00:00:00.000Z", end: "2026-06-08T00:00:00.000Z" })
    expect(w.range.start).toBe("2026-05-11T00:00:00.000Z")
    expect(w.range.end).toBe("2026-06-15T00:00:00.000Z")
  })

  it("uses the previous complete ISO week relative to as_of", () => {
    // Wed 2026-06-24 -> current ISO week starts Mon 06-22 -> previous week 06-15..06-22
    const w = computeWindows({ asOf: new Date("2026-06-24T09:00:00Z") })
    expect(w.current).toEqual({ start: "2026-06-15T00:00:00.000Z", end: "2026-06-22T00:00:00.000Z" })
  })

  it("rejects a malformed week_start", () => {
    expect(() => computeWindows({ weekStart: "June 8" })).toThrow()
  })

  it("rejects a non-Monday week_start", () => {
    expect(() => computeWindows({ weekStart: "2026-06-10" })).toThrow(/Monday/)
  })
})

describe("pctDelta", () => {
  it("computes relative change", () => {
    expect(pctDelta(12, 4)).toEqual({ abs: 8, pct: 2 })
    expect(pctDelta(8, 10)).toEqual({ abs: -2, pct: -0.2 })
  })
  it("returns null pct when prior is 0 and current is non-zero (new)", () => {
    expect(pctDelta(5, 0)).toEqual({ abs: 5, pct: null })
    expect(pctDelta(0, 0)).toEqual({ abs: 0, pct: 0 })
  })
})

describe("aggregate (current window only)", () => {
  const current: SalesFloorRows = {
    calls: fixture.calls.filter((c) => c.started_at === inCurrent),
    qa: fixture.qa.filter((q) => q.created_at === inCurrent),
    modules: fixture.modules.filter((m) => m.created_at === inCurrent),
  }
  const m = aggregate(current)

  it("computes volume, agents, talk time", () => {
    expect(m.callVolume).toBe(12)
    expect(m.uniqueAgents).toBe(2)
    expect(m.avgTalkTimeSec).toBe(150) // (6*100 + 6*200)/12
  })
  it("computes QA-derived rates over evaluated calls", () => {
    expect(m.qaCoverage).toBe(1)
    expect(m.avgQualityScore).toBe(2.5) // (6*4 + 6*1)/12
    expect(m.compliancePassRate).toBe(0.5)
    expect(m.managerEscalationRate).toBe(0.5)
    expect(m.csatPositiveRate).toBe(0.5)
    expect(m.poorQualityRate).toBe(0.5)
  })
  it("caps QA coverage at 100% when async QA rows outnumber call rows in a weekly bucket", () => {
    const m = aggregate({ calls: calls(1, "a@pennie.com", inCurrent, 100, "Sale"), qa: qa(2, "a@pennie.com", inCurrent, {}), modules: [] })
    expect(m.qaCoverage).toBe(1)
  })
  it("computes module flag rates and disposition mix", () => {
    const dr = m.moduleViolationRates.find((r) => r.module === "disposition_review")
    expect(dr).toMatchObject({ total: 12, violations: 6, rate: 0.5 })
    expect(m.dispositionMix[0].count).toBe(6)
  })
})

describe("buildReport", () => {
  const report = buildReport(fixture, computeWindows({ weekStart: WEEK_START }), "2026-06-22T00:00:00Z")

  it("gates leaderboard/watchlist on minimum sample and ranks by quality", () => {
    expect(report.leaderboard.map((a) => a.agent_email)).toEqual(["a@pennie.com", "b@pennie.com"])
    const flagged = report.watchlist.map((w) => w.agent_email)
    expect(flagged).toEqual(["b@pennie.com"]) // a@ is clean
    expect(report.watchlist[0].reasons.length).toBeGreaterThanOrEqual(3)
  })

  it("rolls up by manager", () => {
    expect(report.managers[0].manager_email).toBe("mgr@pennie.com")
    expect(report.managers[0].qaCount).toBe(12)
  })

  it("emits action insights across the expected categories", () => {
    const cats = new Set(report.insights.map((i) => i.category))
    expect(cats.has("improving")).toBe(true) // volume up vs prior
    expect(cats.has("attention")).toBe(true) // compliance drop + escalation rise
    expect(cats.has("coaching")).toBe(true) // dispo-review baseline + watchlist
    const titles = report.insights.map((i) => i.title).join(" | ")
    expect(titles).toMatch(/Compliance pass rate dropped/)
    expect(titles).toMatch(/Coach b@pennie.com/)
  })

  it("uses inclusive start and exclusive end boundaries", () => {
    const w = computeWindows({ weekStart: WEEK_START })
    const seam = buildReport({
      calls: [
        { started_at: w.current.start, agent_email: "start@pennie.com", talk_time: 1, disposition: "A", direction: "outbound" },
        { started_at: w.current.end, agent_email: "end@pennie.com", talk_time: 1, disposition: "B", direction: "outbound" },
      ],
      qa: [],
      modules: [],
    }, w)
    expect(seam.current.callVolume).toBe(1)
    expect(seam.current.uniqueAgents).toBe(1)
  })
})
