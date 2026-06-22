/**
 * Sales Floor Insights — pure aggregation + action heuristics for the weekly
 * management report. No I/O here: DatabaseService.getSalesFloorRows() fetches the
 * (already-redacted) rows, this module turns them into windows, metrics, and
 * action-oriented insights. Keeping it pure makes the math deterministically
 * testable without Supabase.
 *
 * Privacy: callers must only pass redacted rows (no transcripts, names, phones,
 * or free-form quotes). Agent/manager emails are used solely as coaching
 * identifiers. AI module signals (esp. disposition_review) are directional, not
 * validated truth — surfaced as "review" prompts, never as proven violations.
 */

// ---------------------------------------------------------------------------
// Row shapes (redacted — match the SELECT in DatabaseService.getSalesFloorRows)
// ---------------------------------------------------------------------------

export interface CallRow {
  started_at: string
  agent_email: string | null
  talk_time: number | null
  disposition: string | null
  direction: string | null
}

export interface QaRow {
  created_at: string
  agent_email: string | null
  manager_email: string | null
  overall_score: string | null // excellent | good | needs_improvement | poor
  compliance_rating: string | null // pass | fail
  customer_satisfaction_likely: string | null // high | medium | low
  manager_escalation: boolean | null
}

export interface ModuleRow {
  created_at: string
  module_name: string
  has_violation: boolean | null
  agent_email: string | null
}

export interface SalesFloorRows {
  calls: CallRow[]
  qa: QaRow[]
  modules: ModuleRow[]
}

// ---------------------------------------------------------------------------
// Tunables — minimum samples so we never coach off noise, and delta thresholds
// for what counts as a "real" week-over-week move.
// ---------------------------------------------------------------------------

export const MIN_CALLS_FOR_AGENT = 5
export const MIN_QA_FOR_RATE = 5
export const MIN_MODULE_FOR_RATE = 5
export const LEADERBOARD_SIZE = 10
export const LOW_QA_COVERAGE = 0.5 // below this, signals are directional only

// rate moves expressed in percentage points (0.05 = 5pts)
const VOLUME_WOW_PCT = 0.15
const COMPLIANCE_DROP_PTS = 0.05
const ESCALATION_RISE_PTS = 0.05
const DISPO_REVIEW_RISE_PTS = 0.05
const WATCH_COMPLIANCE_FLOOR = 0.8
const WATCH_ESCALATION_CEIL = 0.2
const WATCH_DISPO_REVIEW_CEIL = 0.25
const WATCH_POOR_QUALITY_CEIL = 0.3

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Date windows (all UTC). "Previous complete week" = the Mon–Sun that fully
// precedes the ISO week containing as_of.
// ---------------------------------------------------------------------------

export interface Window {
  start: string // inclusive, ISO
  end: string // exclusive, ISO
}

export interface ReportWindows {
  current: Window // T-1 week (7d)
  prior: Window // the 7d before that — WoW baseline
  baseline: Window // the 28d before current — trailing-month baseline
  range: Window // full span we fetch in one shot [baseline.start, current.end)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Start (Mon 00:00:00 UTC) of the ISO week containing `ms`. */
function startOfIsoWeek(ms: number): number {
  const d = new Date(ms)
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return midnight - dow * DAY_MS
}

export function computeWindows(opts: { asOf?: Date; weekStart?: string } = {}): ReportWindows {
  let weekStartMs: number
  if (opts.weekStart) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.weekStart)
    if (!m) throw new Error(`Invalid week_start (expected YYYY-MM-DD): ${opts.weekStart}`)
    weekStartMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (new Date(weekStartMs).getUTCDay() !== 1) {
      throw new Error(`Invalid week_start (expected a Monday in UTC): ${opts.weekStart}`)
    }
  } else {
    const asOfMs = (opts.asOf ?? new Date()).getTime()
    weekStartMs = startOfIsoWeek(asOfMs) - 7 * DAY_MS // previous complete week
  }
  const currentEnd = weekStartMs + 7 * DAY_MS
  const priorStart = weekStartMs - 7 * DAY_MS
  const baselineStart = weekStartMs - 28 * DAY_MS
  return {
    current: { start: iso(weekStartMs), end: iso(currentEnd) },
    prior: { start: iso(priorStart), end: iso(weekStartMs) },
    baseline: { start: iso(baselineStart), end: iso(weekStartMs) },
    range: { start: iso(baselineStart), end: iso(currentEnd) },
  }
}

function inWindow(ts: string | null, w: Window): boolean {
  if (!ts) return false
  return ts >= w.start && ts < w.end // ISO strings sort lexicographically by time
}

function bucket<T extends { [k: string]: any }>(rows: T[], tsKey: keyof T, w: Window): T[] {
  return rows.filter((r) => inWindow(r[tsKey] as string | null, w))
}

// ---------------------------------------------------------------------------
// Deltas + normalizers
// ---------------------------------------------------------------------------

export interface Delta {
  abs: number
  /** relative change; null when prior is 0 (can't divide — treat as "new"). */
  pct: number | null
}

export function pctDelta(current: number, prior: number): Delta {
  const abs = current - prior
  if (prior === 0) return { abs, pct: current === 0 ? 0 : null }
  return { abs, pct: abs / prior }
}

const QUALITY_MAP: Record<string, number> = {
  excellent: 4,
  good: 3,
  needs_improvement: 2,
  poor: 1,
}
const CSAT_MAP: Record<string, number> = { high: 1, medium: 0.5, low: 0 }

const norm = (s: string | null): string => (s ?? "").trim().toLowerCase()
const qualityNum = (s: string | null): number | null => QUALITY_MAP[norm(s)] ?? null
const csatNum = (s: string | null): number | null => CSAT_MAP[norm(s)] ?? null
const isPass = (s: string | null): boolean => norm(s) === "pass"

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
function rate(numer: number, denom: number): number | null {
  return denom ? numer / denom : null
}
function cappedRate(numer: number, denom: number): number | null {
  const r = rate(numer, denom)
  return r === null ? null : Math.min(1, r)
}

// ---------------------------------------------------------------------------
// Metrics for a single window
// ---------------------------------------------------------------------------

export interface DispositionSlice {
  disposition: string
  count: number
  pct: number
}
export interface ModuleViolationRate {
  module: string
  total: number
  violations: number
  rate: number | null
}

export interface Metrics {
  callVolume: number
  uniqueAgents: number
  avgTalkTimeSec: number | null
  qaCount: number
  qaCoverage: number | null
  avgQualityScore: number | null // 1–4 scale
  goodPlusRate: number | null // share excellent|good
  poorQualityRate: number | null // share poor|needs_improvement
  compliancePassRate: number | null
  complianceN: number
  managerEscalationRate: number | null
  csatAvg: number | null // 0–1
  csatPositiveRate: number | null // share "high"
  dispositionMix: DispositionSlice[]
  moduleViolationRates: ModuleViolationRate[]
}

const DISPO_TOP_N = 8

export function aggregate(rows: SalesFloorRows): Metrics {
  const { calls, qa, modules } = rows

  const agents = new Set<string>()
  const talk: number[] = []
  const dispoCounts = new Map<string, number>()
  for (const c of calls) {
    if (c.agent_email) agents.add(c.agent_email.toLowerCase())
    if (typeof c.talk_time === "number" && c.talk_time >= 0) talk.push(c.talk_time)
    const d = c.disposition?.trim() || "(none)"
    dispoCounts.set(d, (dispoCounts.get(d) ?? 0) + 1)
  }

  const dispositionMix: DispositionSlice[] = [...dispoCounts.entries()]
    .map(([disposition, count]) => ({ disposition, count, pct: count / Math.max(calls.length, 1) }))
    .sort((a, b) => b.count - a.count)
  const topDispo = dispositionMix.slice(0, DISPO_TOP_N)
  const rest = dispositionMix.slice(DISPO_TOP_N)
  if (rest.length) {
    const count = rest.reduce((s, d) => s + d.count, 0)
    topDispo.push({ disposition: "(other)", count, pct: count / Math.max(calls.length, 1) })
  }

  const qualityNums = qa.map((r) => qualityNum(r.overall_score)).filter((n): n is number => n !== null)
  const goodPlus = qa.filter((r) => ["excellent", "good"].includes(norm(r.overall_score)))
  const poor = qa.filter((r) => ["poor", "needs_improvement"].includes(norm(r.overall_score)))
  const compScored = qa.filter((r) => norm(r.compliance_rating) === "pass" || norm(r.compliance_rating) === "fail")
  const csatNums = qa.map((r) => csatNum(r.customer_satisfaction_likely)).filter((n): n is number => n !== null)
  const csatHigh = qa.filter((r) => norm(r.customer_satisfaction_likely) === "high")
  const escalated = qa.filter((r) => r.manager_escalation === true)

  const modByName = new Map<string, { total: number; violations: number }>()
  for (const m of modules) {
    const e = modByName.get(m.module_name) ?? { total: 0, violations: 0 }
    e.total += 1
    if (m.has_violation) e.violations += 1
    modByName.set(m.module_name, e)
  }
  const moduleViolationRates: ModuleViolationRate[] = [...modByName.entries()]
    .map(([module, v]) => ({ module, total: v.total, violations: v.violations, rate: rate(v.violations, v.total) }))
    .sort((a, b) => a.module.localeCompare(b.module))

  return {
    callVolume: calls.length,
    uniqueAgents: agents.size,
    avgTalkTimeSec: mean(talk),
    qaCount: qa.length,
    qaCoverage: cappedRate(qa.length, calls.length),
    avgQualityScore: mean(qualityNums),
    goodPlusRate: rate(goodPlus.length, qa.length),
    poorQualityRate: rate(poor.length, qa.length),
    compliancePassRate: rate(compScored.filter((r) => isPass(r.compliance_rating)).length, compScored.length),
    complianceN: compScored.length,
    managerEscalationRate: rate(escalated.length, qa.length),
    csatAvg: mean(csatNums),
    csatPositiveRate: rate(csatHigh.length, qa.length),
    dispositionMix: topDispo,
    moduleViolationRates,
  }
}

function dispoReviewRate(m: Metrics): number | null {
  return m.moduleViolationRates.find((r) => r.module === "disposition_review")?.rate ?? null
}

// ---------------------------------------------------------------------------
// Per-agent + per-manager rollups
// ---------------------------------------------------------------------------

export interface AgentStats {
  agent_email: string
  callVolume: number
  qaCount: number
  avgTalkTimeSec: number | null
  avgQualityScore: number | null
  compliancePassRate: number | null
  complianceN: number
  managerEscalationRate: number | null
  csatPositiveRate: number | null
  poorQualityRate: number | null
  dispositionReviewRate: number | null
  dispositionReviewN: number
}

function statsFor(calls: CallRow[], qa: QaRow[], modules: ModuleRow[], email: string): AgentStats {
  const m = aggregate({ calls, qa, modules })
  return {
    agent_email: email,
    callVolume: m.callVolume,
    qaCount: m.qaCount,
    avgTalkTimeSec: m.avgTalkTimeSec,
    avgQualityScore: m.avgQualityScore,
    compliancePassRate: m.compliancePassRate,
    complianceN: m.complianceN,
    managerEscalationRate: m.managerEscalationRate,
    csatPositiveRate: m.csatPositiveRate,
    poorQualityRate: m.poorQualityRate,
    dispositionReviewRate: dispoReviewRate(m),
    dispositionReviewN: m.moduleViolationRates.find((r) => r.module === "disposition_review")?.total ?? 0,
  }
}

function groupByAgent(rows: SalesFloorRows): AgentStats[] {
  const keys = new Set<string>()
  const lc = (e: string | null) => (e ? e.toLowerCase() : null)
  for (const c of rows.calls) if (lc(c.agent_email)) keys.add(lc(c.agent_email)!)
  for (const q of rows.qa) if (lc(q.agent_email)) keys.add(lc(q.agent_email)!)
  for (const m of rows.modules) if (lc(m.agent_email)) keys.add(lc(m.agent_email)!)

  return [...keys].map((email) =>
    statsFor(
      rows.calls.filter((c) => lc(c.agent_email) === email),
      rows.qa.filter((q) => lc(q.agent_email) === email),
      rows.modules.filter((m) => lc(m.agent_email) === email),
      email,
    ),
  )
}

export interface ManagerStats {
  manager_email: string
  qaCount: number
  avgQualityScore: number | null
  compliancePassRate: number | null
  managerEscalationRate: number | null
  poorQualityRate: number | null
}

function groupByManager(qa: QaRow[]): ManagerStats[] {
  const byMgr = new Map<string, QaRow[]>()
  for (const q of qa) {
    const k = q.manager_email?.toLowerCase()
    if (!k) continue
    byMgr.set(k, [...(byMgr.get(k) ?? []), q])
  }
  return [...byMgr.entries()]
    .map(([manager_email, rows]) => {
      const m = aggregate({ calls: [], qa: rows, modules: [] })
      return {
        manager_email,
        qaCount: m.qaCount,
        avgQualityScore: m.avgQualityScore,
        compliancePassRate: m.compliancePassRate,
        managerEscalationRate: m.managerEscalationRate,
        poorQualityRate: m.poorQualityRate,
      }
    })
    .sort((a, b) => b.qaCount - a.qaCount)
}

// ---------------------------------------------------------------------------
// Leaderboard + coaching watchlist
// ---------------------------------------------------------------------------

export interface WatchlistEntry extends AgentStats {
  reasons: string[]
}

function buildLeaderboard(agents: AgentStats[]): AgentStats[] {
  return agents
    .filter((a) => a.callVolume >= MIN_CALLS_FOR_AGENT && a.qaCount >= MIN_QA_FOR_RATE)
    .sort((a, b) => {
      const q = (b.avgQualityScore ?? 0) - (a.avgQualityScore ?? 0)
      if (q !== 0) return q
      const c = (b.compliancePassRate ?? 0) - (a.compliancePassRate ?? 0)
      if (c !== 0) return c
      return (a.managerEscalationRate ?? 0) - (b.managerEscalationRate ?? 0)
    })
    .slice(0, LEADERBOARD_SIZE)
}

function buildWatchlist(agents: AgentStats[]): WatchlistEntry[] {
  const out: WatchlistEntry[] = []
  for (const a of agents) {
    if (a.callVolume < MIN_CALLS_FOR_AGENT) continue
    const reasons: string[] = []
    if (a.complianceN >= MIN_QA_FOR_RATE && a.compliancePassRate !== null && a.compliancePassRate < WATCH_COMPLIANCE_FLOOR)
      reasons.push(`compliance pass ${pct(a.compliancePassRate)} (< ${pct(WATCH_COMPLIANCE_FLOOR)})`)
    if (a.qaCount >= MIN_QA_FOR_RATE && a.managerEscalationRate !== null && a.managerEscalationRate > WATCH_ESCALATION_CEIL)
      reasons.push(`manager-escalation ${pct(a.managerEscalationRate)} (> ${pct(WATCH_ESCALATION_CEIL)})`)
    if (a.qaCount >= MIN_QA_FOR_RATE && a.poorQualityRate !== null && a.poorQualityRate > WATCH_POOR_QUALITY_CEIL)
      reasons.push(`poor/needs-improvement ${pct(a.poorQualityRate)} (> ${pct(WATCH_POOR_QUALITY_CEIL)})`)
    if (
      a.dispositionReviewN >= MIN_MODULE_FOR_RATE &&
      a.dispositionReviewRate !== null &&
      a.dispositionReviewRate > WATCH_DISPO_REVIEW_CEIL
    )
      reasons.push(`disposition-review flags ${pct(a.dispositionReviewRate)} (directional, > ${pct(WATCH_DISPO_REVIEW_CEIL)})`)
    if (reasons.length) out.push({ ...a, reasons })
  }
  // worst first: most reasons, then lowest compliance
  return out.sort((a, b) => b.reasons.length - a.reasons.length || (a.compliancePassRate ?? 1) - (b.compliancePassRate ?? 1))
}

// ---------------------------------------------------------------------------
// Action-oriented insights
// ---------------------------------------------------------------------------

export type InsightCategory = "changed" | "attention" | "coaching" | "improving" | "insufficient_data"
export type InsightSeverity = "info" | "watch" | "alert"

export interface Insight {
  category: InsightCategory
  severity: InsightSeverity
  title: string
  detail: string
}

function pts(x: number): string {
  return `${(x * 100).toFixed(1)}pts`
}
function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`
}

function buildInsights(
  current: Metrics,
  prior: Metrics,
  baseline: Metrics,
  watchlist: WatchlistEntry[],
  agents: AgentStats[],
): Insight[] {
  const out: Insight[] = []

  // Data sufficiency first — frames everything below as directional or solid.
  if (current.qaCoverage !== null && current.qaCoverage < LOW_QA_COVERAGE) {
    out.push({
      category: "insufficient_data",
      severity: "watch",
      title: "QA coverage is low — treat quality/compliance signals as directional",
      detail: `Only ${pct(current.qaCoverage)} of ${current.callVolume} calls were QA-evaluated this week. Rates below are based on a partial sample.`,
    })
  }
  const qualifying = agents.filter((a) => a.callVolume >= MIN_CALLS_FOR_AGENT).length
  const tooThin = agents.filter((a) => a.callVolume > 0 && a.callVolume < MIN_CALLS_FOR_AGENT).length
  if (tooThin > 0) {
    out.push({
      category: "insufficient_data",
      severity: "info",
      title: `${tooThin} agent(s) below the ${MIN_CALLS_FOR_AGENT}-call coaching threshold`,
      detail: `${qualifying} agent(s) have enough volume for per-agent coaching this week; ${tooThin} do not and are excluded from the leaderboard/watchlist.`,
    })
  }

  // Volume WoW
  const vol = pctDelta(current.callVolume, prior.callVolume)
  if (vol.pct !== null && Math.abs(vol.pct) >= VOLUME_WOW_PCT) {
    const up = vol.abs > 0
    out.push({
      category: up ? "improving" : "changed",
      severity: up ? "info" : "watch",
      title: `Call volume ${up ? "up" : "down"} ${pct(Math.abs(vol.pct))} WoW`,
      detail: `${current.callVolume} calls this week vs ${prior.callVolume} last week (${current.uniqueAgents} vs ${prior.uniqueAgents} active agents).`,
    })
  }

  // Compliance WoW drop
  if (
    current.compliancePassRate !== null &&
    prior.compliancePassRate !== null &&
    current.complianceN >= MIN_QA_FOR_RATE &&
    prior.compliancePassRate - current.compliancePassRate >= COMPLIANCE_DROP_PTS
  ) {
    out.push({
      category: "attention",
      severity: "alert",
      title: `Compliance pass rate dropped ${pts(prior.compliancePassRate - current.compliancePassRate)} WoW`,
      detail: `Now ${pct(current.compliancePassRate)} (was ${pct(prior.compliancePassRate)}). Review failed-compliance calls and reinforce disclosures/consent in coaching.`,
    })
  }

  // Escalation WoW rise
  if (
    current.managerEscalationRate !== null &&
    prior.managerEscalationRate !== null &&
    current.qaCount >= MIN_QA_FOR_RATE &&
    current.managerEscalationRate - prior.managerEscalationRate >= ESCALATION_RISE_PTS
  ) {
    out.push({
      category: "attention",
      severity: "alert",
      title: `Manager-escalation rate up ${pts(current.managerEscalationRate - prior.managerEscalationRate)} WoW`,
      detail: `Now ${pct(current.managerEscalationRate)} (was ${pct(prior.managerEscalationRate)}). More calls are being flagged for manager review — check which agents/managers are driving it.`,
    })
  }

  // disposition_review vs trailing-month baseline (directional AI signal)
  const drCur = dispoReviewRate(current)
  const drBase = dispoReviewRate(baseline)
  const drCurN = current.moduleViolationRates.find((r) => r.module === "disposition_review")?.total ?? 0
  const drBaseN = baseline.moduleViolationRates.find((r) => r.module === "disposition_review")?.total ?? 0
  if (
    drCur !== null &&
    drBase !== null &&
    drCurN >= MIN_MODULE_FOR_RATE &&
    drBaseN >= MIN_MODULE_FOR_RATE &&
    drCur - drBase >= DISPO_REVIEW_RISE_PTS
  ) {
    out.push({
      category: "coaching",
      severity: "watch",
      title: `Disposition-review flags up ${pts(drCur - drBase)} vs trailing month`,
      detail: `AI flagged ${pct(drCur)} of evaluated calls this week vs a ${pct(drBase)} trailing-month baseline. Directional only — spot-check flagged calls before coaching on call dispositioning.`,
    })
  }

  // Quality improvement WoW
  if (
    current.avgQualityScore !== null &&
    prior.avgQualityScore !== null &&
    current.avgQualityScore - prior.avgQualityScore >= 0.2
  ) {
    out.push({
      category: "improving",
      severity: "info",
      title: "Average call quality improved WoW",
      detail: `Avg quality ${current.avgQualityScore.toFixed(2)}/4 (was ${prior.avgQualityScore.toFixed(2)}/4). Reinforce what's working.`,
    })
  }

  // Watchlist → concrete coaching actions
  for (const w of watchlist.slice(0, 5)) {
    out.push({
      category: "coaching",
      severity: "watch",
      title: `Coach ${w.agent_email}`,
      detail: `${w.callVolume} calls, ${w.qaCount} QA'd. Flags: ${w.reasons.join("; ")}.`,
    })
  }

  if (out.length === 0) {
    out.push({
      category: "changed",
      severity: "info",
      title: "No significant week-over-week movement",
      detail: "All tracked metrics are within normal thresholds vs last week and the trailing-month baseline.",
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export interface SalesFloorReport {
  generated_at: string | null
  windows: ReportWindows
  current: Metrics
  prior: Metrics
  baseline: Metrics
  wow: Record<string, Delta>
  managers: ManagerStats[]
  leaderboard: AgentStats[]
  watchlist: WatchlistEntry[]
  insights: Insight[]
  notes: string[]
}

function wowDeltas(c: Metrics, p: Metrics): Record<string, Delta> {
  const z = (n: number | null) => n ?? 0
  return {
    callVolume: pctDelta(c.callVolume, p.callVolume),
    uniqueAgents: pctDelta(c.uniqueAgents, p.uniqueAgents),
    avgTalkTimeSec: pctDelta(z(c.avgTalkTimeSec), z(p.avgTalkTimeSec)),
    qaCoverage: pctDelta(z(c.qaCoverage), z(p.qaCoverage)),
    avgQualityScore: pctDelta(z(c.avgQualityScore), z(p.avgQualityScore)),
    compliancePassRate: pctDelta(z(c.compliancePassRate), z(p.compliancePassRate)),
    managerEscalationRate: pctDelta(z(c.managerEscalationRate), z(p.managerEscalationRate)),
    csatPositiveRate: pctDelta(z(c.csatPositiveRate), z(p.csatPositiveRate)),
  }
}

/**
 * Build the full report from redacted rows over the fetch `range`. Buckets rows
 * into current/prior/baseline windows, aggregates, and derives insights.
 * `generatedAt` is injected (not read from a clock) so output is deterministic.
 */
export function buildReport(
  rows: SalesFloorRows,
  windows: ReportWindows,
  generatedAt: string | null = null,
): SalesFloorReport {
  const slice = (w: Window): SalesFloorRows => ({
    calls: bucket(rows.calls, "started_at", w),
    qa: bucket(rows.qa, "created_at", w),
    modules: bucket(rows.modules, "created_at", w),
  })

  const currentRows = slice(windows.current)
  const current = aggregate(currentRows)
  const prior = aggregate(slice(windows.prior))
  const baseline = aggregate(slice(windows.baseline))

  const agents = groupByAgent(currentRows)
  const leaderboard = buildLeaderboard(agents)
  const watchlist = buildWatchlist(agents)
  const managers = groupByManager(currentRows.qa)
  const insights = buildInsights(current, prior, baseline, watchlist, agents)

  return {
    generated_at: generatedAt,
    windows,
    current,
    prior,
    baseline,
    wow: wowDeltas(current, prior),
    managers,
    leaderboard,
    watchlist,
    insights,
    notes: [
      "Window is the previous complete Mon–Sun week (UTC). WoW compares the prior 7 days; trailing-month baseline is the prior 28 days.",
      "QA/compliance/CSAT rates are over QA-evaluated calls only, not all calls — see qaCoverage.",
      "disposition_review and other AI module flags are directional signals, not validated violations.",
      "Emails are coaching identifiers only. No transcripts, customer names, phones, or quotes are included.",
    ],
  }
}

export { groupByAgent, buildLeaderboard, buildWatchlist, groupByManager, buildInsights }
