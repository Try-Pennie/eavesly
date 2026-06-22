/**
 * Print/PDF-friendly HTML renderer for the Sales Floor Insights report.
 * Self-contained (inline CSS, no external assets) so it renders identically in a
 * browser "Print to PDF" with no network. Pure string output — no I/O.
 */
import type {
  SalesFloorReport,
  Metrics,
  Delta,
  AgentStats,
  ManagerStats,
  WatchlistEntry,
  Insight,
} from "./sales-floor-insights"

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(1)}%`)
const num = (x: number | null, d = 0): string => (x === null ? "—" : x.toFixed(d))
const secs = (x: number | null): string => (x === null ? "—" : `${Math.round(x)}s`)
const day = (iso: string): string => iso.slice(0, 10)

/** WoW arrow + relative %. `goodUp` controls red/green coloring. */
function trend(d: Delta | undefined, goodUp = true): string {
  if (!d || d.pct === null) return `<span class="muted">new</span>`
  if (d.abs === 0) return `<span class="muted">flat</span>`
  const up = d.abs > 0
  const good = up === goodUp
  const arrow = up ? "▲" : "▼"
  return `<span class="${good ? "up" : "down"}">${arrow} ${(Math.abs(d.pct) * 100).toFixed(1)}%</span>`
}

function kpi(label: string, value: string, d?: Delta, goodUp = true): string {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-trend">${
    d ? trend(d, goodUp) : ""
  }</div></div>`
}

function metricsKpis(m: Metrics, wow: SalesFloorReport["wow"]): string {
  return [
    kpi("Calls", String(m.callVolume), wow.callVolume, true),
    kpi("Active agents", String(m.uniqueAgents), wow.uniqueAgents, true),
    kpi("Avg talk time", secs(m.avgTalkTimeSec), wow.avgTalkTimeSec, true),
    kpi("QA coverage", pct(m.qaCoverage), wow.qaCoverage, true),
    kpi("Avg quality (/4)", num(m.avgQualityScore, 2), wow.avgQualityScore, true),
    kpi("Compliance pass", pct(m.compliancePassRate), wow.compliancePassRate, true),
    kpi("Mgr escalation", pct(m.managerEscalationRate), wow.managerEscalationRate, false),
    kpi("CSAT high", pct(m.csatPositiveRate), wow.csatPositiveRate, true),
  ].join("")
}

const SEV_BADGE: Record<Insight["severity"], string> = { alert: "🔴", watch: "🟡", info: "🟢" }
const CAT_LABEL: Record<Insight["category"], string> = {
  changed: "What changed",
  attention: "Needs attention",
  coaching: "Coaching focus",
  improving: "Improving",
  insufficient_data: "Data caveats",
}

function insightsSection(insights: Insight[]): string {
  const order: Insight["category"][] = ["attention", "coaching", "changed", "improving", "insufficient_data"]
  const groups = order
    .map((cat) => {
      const items = insights.filter((i) => i.category === cat)
      if (!items.length) return ""
      return `<div class="insight-group"><h3>${CAT_LABEL[cat]}</h3>${items
        .map(
          (i) =>
            `<div class="insight"><div class="insight-title">${SEV_BADGE[i.severity]} ${esc(
              i.title,
            )}</div><div class="insight-detail">${esc(i.detail)}</div></div>`,
        )
        .join("")}</div>`
    })
    .join("")
  return `<section><h2>Action insights</h2>${groups}</section>`
}

function leaderboardTable(rows: AgentStats[]): string {
  if (!rows.length) return `<p class="muted">No agents met the minimum-sample threshold this week.</p>`
  const body = rows
    .map(
      (a, i) =>
        `<tr><td>${i + 1}</td><td>${esc(a.agent_email)}</td><td>${a.callVolume}</td><td>${a.qaCount}</td><td>${num(
          a.avgQualityScore,
          2,
        )}</td><td>${pct(a.compliancePassRate)}</td><td>${pct(a.managerEscalationRate)}</td><td>${pct(
          a.csatPositiveRate,
        )}</td></tr>`,
    )
    .join("")
  return `<table><thead><tr><th>#</th><th>Agent</th><th>Calls</th><th>QA'd</th><th>Quality /4</th><th>Compliance</th><th>Escalation</th><th>CSAT high</th></tr></thead><tbody>${body}</tbody></table>`
}

function watchlistTable(rows: WatchlistEntry[]): string {
  if (!rows.length) return `<p class="muted">No agents flagged for coaching this week. 🎉</p>`
  const body = rows
    .map(
      (a) =>
        `<tr><td>${esc(a.agent_email)}</td><td>${a.callVolume}</td><td>${a.qaCount}</td><td>${a.reasons
          .map(esc)
          .join("<br>")}</td></tr>`,
    )
    .join("")
  return `<table><thead><tr><th>Agent</th><th>Calls</th><th>QA'd</th><th>Why flagged</th></tr></thead><tbody>${body}</tbody></table>`
}

function managerTable(rows: ManagerStats[]): string {
  if (!rows.length) return `<p class="muted">No manager attribution available this week.</p>`
  const body = rows
    .map(
      (m) =>
        `<tr><td>${esc(m.manager_email)}</td><td>${m.qaCount}</td><td>${num(m.avgQualityScore, 2)}</td><td>${pct(
          m.compliancePassRate,
        )}</td><td>${pct(m.managerEscalationRate)}</td><td>${pct(m.poorQualityRate)}</td></tr>`,
    )
    .join("")
  return `<table><thead><tr><th>Manager</th><th>QA'd calls</th><th>Quality /4</th><th>Compliance</th><th>Escalation</th><th>Poor/NI</th></tr></thead><tbody>${body}</tbody></table>`
}

function dispositionTable(m: Metrics): string {
  if (!m.dispositionMix.length) return `<p class="muted">No dispositions recorded.</p>`
  const body = m.dispositionMix
    .map((d) => `<tr><td>${esc(d.disposition)}</td><td>${d.count}</td><td>${pct(d.pct)}</td></tr>`)
    .join("")
  return `<table><thead><tr><th>Disposition</th><th>Count</th><th>Share</th></tr></thead><tbody>${body}</tbody></table>`
}

function moduleTable(m: Metrics): string {
  if (!m.moduleViolationRates.length) return `<p class="muted">No module evaluations in this window.</p>`
  const body = m.moduleViolationRates
    .map(
      (r) =>
        `<tr><td>${esc(r.module)}</td><td>${r.total}</td><td>${r.violations}</td><td>${pct(r.rate)}</td></tr>`,
    )
    .join("")
  return `<table><thead><tr><th>Module</th><th>Evaluated</th><th>Flagged</th><th>Flag rate</th></tr></thead><tbody>${body}</tbody></table>`
}

export function renderReportHtml(report: SalesFloorReport): string {
  const w = report.windows
  const title = `Sales Floor Insights — week of ${day(w.current.start)}`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink:#1a1a2e; --muted:#6b7280; --line:#e5e7eb; --up:#15803d; --down:#b91c1c; --bg:#fff; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: #f3f4f6; margin: 0; padding: 24px; }
  .page { max-width: 1000px; margin: 0 auto; background: var(--bg); padding: 32px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header .sub { color: var(--muted); font-size: 13px; }
  h2 { font-size: 16px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; margin: 28px 0 12px; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
  .kpi-value { font-size: 22px; font-weight: 700; margin: 2px 0; }
  .kpi-trend { font-size: 12px; min-height: 16px; }
  .up { color: var(--up); font-weight: 600; }
  .down { color: var(--down); font-weight: 600; }
  .muted { color: var(--muted); }
  .insight { border-left: 3px solid var(--line); padding: 4px 0 4px 10px; margin: 6px 0; }
  .insight-title { font-weight: 600; }
  .insight-detail { color: #374151; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
  tbody tr:nth-child(odd) { background: #fafafa; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  footer li { margin: 2px 0; }
  @media print {
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; max-width: none; padding: 0; }
    h2 { page-break-after: avoid; }
    table, .insight-group, .kpi { page-break-inside: avoid; }
  }
</style></head>
<body><div class="page">
  <header>
    <h1>${esc(title)}</h1>
    <div class="sub">${day(w.current.start)} → ${day(w.current.end)} (UTC) · WoW vs ${day(w.prior.start)}–${day(
    w.prior.end,
  )} · trailing-month baseline from ${day(w.baseline.start)}${
    report.generated_at ? ` · generated ${esc(report.generated_at)}` : ""
  }</div>
  </header>

  <section><h2>Key metrics (WoW)</h2><div class="kpis">${metricsKpis(report.current, report.wow)}</div></section>

  ${insightsSection(report.insights)}

  <section><h2>Manager rollup</h2>${managerTable(report.managers)}</section>

  <section><h2>Agent leaderboard</h2>${leaderboardTable(report.leaderboard)}</section>

  <section><h2>Coaching watchlist</h2>${watchlistTable(report.watchlist)}</section>

  <section><h2>Disposition mix</h2>${dispositionTable(report.current)}</section>

  <section><h2>Module flag rates</h2>${moduleTable(report.current)}</section>

  <footer><strong>How to read this report</strong><ul>${report.notes
    .map((n) => `<li>${esc(n)}</li>`)
    .join("")}</ul></footer>
</div></body></html>`
}
