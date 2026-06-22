# Sales Floor Insights report

## Purpose

The Sales Floor Insights report gives management a weekly, action-driven view of sales-floor performance. It is designed for the previous complete week (T-1 week), with week-over-week (WoW) comparisons and a trailing-month baseline so managers can decide what to review in coaching.

V1 intentionally avoids an LLM-generated narrative. The report uses deterministic aggregate metrics and conservative heuristics so managers can trust the math and see exactly why an insight was surfaced.

## Endpoints

Both endpoints require the existing internal API auth middleware.

- `GET /api/v1/reports/sales-floor-insights` — JSON payload for automation.
- `GET /api/v1/reports/sales-floor-insights.html` — self-contained HTML report with print styles. Use browser **Print → Save as PDF** for a PDF artifact.

Optional query parameters:

- `week_start=YYYY-MM-DD` — explicit reported-week start date. Intended to be a Monday in UTC.
- `as_of=YYYY-MM-DD` — derive the previous complete ISO week relative to this date.

If no query parameter is provided, the report uses the previous complete Mon-Sun week in UTC.

## Data sources

`DatabaseService.getSalesFloorRows(startIso, endIso)` fetches only aggregate-safe columns from Supabase:

| Table | Timestamp | Columns used |
|---|---|---|
| `eavesly_calls` | `started_at` | `started_at`, `agent_email`, `talk_time`, `disposition`, `direction` |
| `eavesly_transcription_qa` | `created_at` | `created_at`, `agent_email`, `manager_email`, `overall_score`, `compliance_rating`, `customer_satisfaction_likely`, `manager_escalation` |
| `eavesly_module_results` | `created_at` | `created_at`, `module_name`, `has_violation`, `agent_email` |

No transcripts, customer names, phone numbers, summaries, recordings, transcript URLs, raw evidence, or free-form quotes are selected or rendered.

## Windows

For reported week `W`:

- **Current / T-1 week:** `[W, W + 7 days)`
- **WoW prior:** `[W - 7 days, W)`
- **Trailing-month baseline:** `[W - 28 days, W)`
- **Fetch range:** `[W - 28 days, W + 7 days)`

All boundaries are UTC. QA/module rows are bucketed by their own `created_at`, while calls use `started_at`. That means a call near a boundary and its later QA result can land in adjacent buckets. V1 caps QA coverage at 100% and treats this as acceptable for aggregate weekly management reporting; if exact call-to-QA alignment becomes important, move aggregation into a Postgres view/RPC that joins by `call_id`.

Report data fetches fail loudly. A Supabase query error returns a generic 500 from the route instead of silently rendering zeros, because false-clear management reports are worse than no report.

## Metrics

Current, prior, and baseline windows include:

- Call volume
- Unique active agents
- Average talk time
- QA count and QA coverage (`qa rows / calls`, capped at 100% because QA rows can be created after the source call week boundary)
- Average quality score on a 1-4 scale (`poor=1`, `needs_improvement=2`, `good=3`, `excellent=4`)
- Good-plus rate (`excellent` or `good`)
- Poor/needs-improvement rate
- Compliance pass rate over QA rows with `pass`/`fail`
- Manager-escalation rate
- Customer satisfaction proxy (`high=1`, `medium=0.5`, `low=0`), plus high-CSAT rate
- Top disposition mix
- Module flag rates by module, including `disposition_review`

## Action heuristics

The report creates `insights[]` with category/severity/title/detail. Current thresholds:

- QA coverage below 50% → caveat: quality/compliance signals are directional.
- Agent-level coaching requires at least 5 calls; most rate-based flags require at least 5 QA/module rows.
- Call volume movement ≥15% WoW → surfaced as improvement or change.
- Compliance pass drop ≥5 percentage points WoW → attention item.
- Manager-escalation rise ≥5 percentage points WoW → attention item.
- `disposition_review` flag-rate rise ≥5 percentage points vs trailing-month baseline → coaching review item, explicitly directional.
- Agent watchlist flags:
  - Compliance pass below 80%
  - Manager-escalation rate above 20%
  - Poor/needs-improvement rate above 30%
  - `disposition_review` flags above 25% with enough module rows

These are coaching triage signals, not final judgments. Managers should spot-check calls before corrective coaching, especially for AI module flags.

## Privacy and management framing

- Emails are used only as internal coaching identifiers.
- The report intentionally omits raw customer data and transcript evidence.
- AI module flags are labeled directional and should not be presented as validated violations without human review.
- Low QA coverage should block overconfident conclusions; the report keeps the caveat in `notes` and `insights`.

## Suggested weekly operating cadence

1. Generate the HTML report every Monday for the prior complete week.
2. Export to PDF if management wants a durable artifact.
3. Review top action insights first, then the coaching watchlist.
4. Spot-check source calls for flagged agents/modules before taking corrective action.
5. Decide 1-3 management actions for the week: coaching themes, script/disclosure reinforcement, manager shadowing, or taxonomy/prompt tuning.
6. Track whether the same issue improves in the next weekly report.

## V1 limitations / next upgrades

- No scheduler or Slack/email delivery yet. Add a scheduled worker or external cron once the management team validates the report shape.
- No manager roster mapping beyond `manager_email` already present in QA rows.
- No live Postgres aggregate view/RPC. If row volume grows, push aggregation server-side instead of paginating rows through the Worker.
- No human feedback/ground-truth loop for module flags. Add review labels before calling AI flags “accurate.”
