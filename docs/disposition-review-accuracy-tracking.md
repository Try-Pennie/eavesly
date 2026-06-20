# Disposition-Review AI — Accuracy Tracking

Purpose: track the accuracy and alert quality of the `disposition_review` module
(PSAI-182) over time, so we can tune the AI agent toward an actionable,
high-precision alert stream.

- **Module:** `disposition_review` (`src/modules/disposition-review/`)
- **Model:** `DISPOSITION_REVIEW_MODEL = "deepseek/deepseek-chat"` (per-module override)
- **Supabase project:** Eavesly — `miikotqnovnixpeqtqnd`
- **Result store:** `eavesly_module_results` where `module_name = 'disposition_review'`
- **Went live:** 2026-06-19 13:05 UTC

How to read this doc: the **Baseline** is a point-in-time snapshot. The
**Tracking queries** section has copy-paste SQL to regenerate each metric on a
cadence (suggest weekly). Append a new dated row to **Snapshot log** each run.

---

## Baseline snapshot — 2026-06-20 ~02:00 UTC (first ~13h live)

| Metric | Value |
|---|---|
| Total evaluations | 1,542 |
| Flagged as mis-disposition (`has_violation`) | **952 (61.7%)** |
| Alerts stamped sent (`alert_sent`) | 952 (1 per flag) |
| Avg / p50 / p95 / max latency (ms) | 13,116 / 10,051 / 32,831 / 158,259 |
| Avg model confidence (all results) | ~0.95 |
| Requests received → completed | 1,551 → 1,545 (9 silent drops, ~0.6%) |

### Flag breakdown by scenario

| `conversation_happened` | `matches_transcript` | Count | Avg confidence | Read |
|---|---|---|---|---|
| no | false | 413 | 0.969 | **High-value catch** — voicemail/no-answer tagged as completed/interested |
| yes | false | 541 | 0.942 | **Debatable** — real convo, model disagrees with human's judgment tag |
| yes | true | 344 | 0.951 | Agreement (no flag) |
| no | true | 236 | 0.985 | Agreement (no flag) |
| unclear | false | 8 | 0.881 | Edge cases |

### Findings

1. **62% flag rate makes the raw alert stream unactionable.** Six of every ten
   calls flagged. This drove the 2026-06-20 commits muting the Slack alerts
   (`0196c0c`, `987aea5`) — a band-aid, not a fix.
2. **The model is highly confident on both sides (~0.95 avg).** Over-flagging is
   not a "nudge the global threshold" problem; precision has to come from
   *segmenting* the signal.
3. **Two distinct populations inside the flags:**
   - `conversation_happened = "no"` (413): voicemails/no-answers dispositioned as
     real conversations. Clean, defensible, high-value. Candidate to surface now.
   - `conversation_happened = "yes"` (541): the model second-guesses the agent's
     interpretation of a real call. Noisier, more subjective. Needs a higher bar
     or sampling before reaching humans.
4. **~0.6% silent drops:** 9 requests `received` with no `workflow_completed` row,
   no `status_code`, no `error_message`. They fail invisibly (won't trip any
   error alert). Likely linked to the 158s latency tail / workflow timeouts.

### Taxonomy descriptions are the top accuracy lever (added 2026-06-20)

Cross-referencing the AI's suggested dispositions against the Dispositions admin
screen (the taxonomy the agent maps to) shows a clear pattern: **dispositions
with an empty Description box account for ~97% of all flags; dispositions with a
written description almost never flag.**

| AI-suggested disposition | Suggested | Flags | Description box |
|---|---|---|---|
| No Action | 463 | 407 | None |
| Interested | 190 | 118 | None |
| Scheduling | 158 | 132 | None |
| Not Interested | 137 | 100 | None |
| Transfer to Agent | 97 | 78 | None |
| Reminder | 71 | 68 | None |
| Do Not Contact | 27 | 15 | None |
| Reminder Confirmation - No Action | 4 | 4 | None |
| 1.4 - Converted/Won | 126 | 15 | Has description |
| 1.5 - Not Interested > END CAMPAIGNS | 71 | 4 | Has description |
| Pre-recorded Voicemail | 157 | 10 | Clear by name |

The numbered dispositions give the model a real definition to anchor on; the
free-text AI-Agent dispositions (No Action / Reminder / Scheduling / Interested)
give it only a label, so it invents its own boundaries — this is the noisy
`conversation_happened=yes / matches=false` bucket.

Two built-in assets to exploit:
- **Fill the Description box** for AI-Agent-visible dispositions, prioritized by
  flag volume, focusing on disambiguation (Reminder vs No Action vs Reminder
  Confirmation; Interested vs 1.3A First Call Completed - Interested). Feed the
  same text into the agent's taxonomy prompt.
- **The "Conversation Happened" column** is a canonical Yes/No per disposition.
  The agent already emits its own `conversation_happened`; a mismatch against the
  disposition's canonical value is a cheap, objective, high-precision flag (the
  clean voicemail bucket).

### Vocabulary mismatch: AI-Agent-only values vs human dispositions (added 2026-06-20)

The prompt's `<ai_eligible>` set (`No Action`, `Interested`, `Reminder`,
`Scheduling`, `Not Interested`, `Transfer to Agent`, `Do Not Contact`,
`Reminder Confirmation - No Action`) are all **"AI Agent" visibility** in the CRM
— **not visible to most human agents**. But every call being reviewed is
dispositioned with a **human / All-Users / team** value. The prompt instructs the
model to "prefer an AI-eligible value," so it maps a human disposition onto an
AI-only one and flags a "mismatch" even when they mean the same thing.

Flag rates by the human-applied current disposition (the fingerprint):

| Current disposition (human-applied) | Visibility | Calls | Flagged | Flag rate |
|---|---|---|---|---|
| 1.1A - No Show - First Call | All Users | 238 | 211 | 89% |
| 1.2 - Interested > No Call Scheduled | All Users | 180 | 155 | 86% |
| 1.5 - Not Interested > END CAMPAIGNS | All Users | 382 | 281 | 74% |
| 1.3A - First Call Completed - Interested | All Users | 201 | 140 | 70% |
| 1.3 - Interested > Call Scheduled | All Users | 84 | 54 | 64% |
| 1.4 - Converted/Won > END CAMPAIGNS | All Users | 140 | 28 | 20% |
| Pre-recorded Voicemail | — | 166 | 19 | 11% |

The near-90% flag rate on the human "interested / no-show" dispositions is the
mismatch, not real mis-dispositioning. `Pre-recorded Voicemail` (11%) is the
control — one of the few values whose meaning maps cleanly across both
vocabularies.

Fix options (design decision):
1. **Swap the preferred set** to the human-visible (All-Users / Manager / team)
   dispositions; drop/demote AI-Agent-only values. Cleanest; definitions for most
   human dispositions are on the CRM Dispositions admin screen.
2. **Equivalence map** — keep both vocabularies, tell the model
   `Interested ≈ 1.2/1.3/1.3A`, `Not Interested ≈ 1.5`, etc.
3. **Scope by dispositioner** — judge AI-dispositioned calls against AI values,
   human-dispositioned calls against human values.

### Recommendations to improve accuracy

- **Split the alert by `conversation_happened`.** Route the `no` bucket as the
  primary signal; hold the `yes` bucket behind a higher confidence/severity bar
  or sample it for manual review before alerting.
- **Build a labeled ground-truth set.** There is no human verdict captured yet —
  accuracy is currently unmeasurable, only flag *rate* is. Sample N flagged calls
  per week, have a reviewer mark correct/incorrect, and store the verdict (see
  `eavesly_alert_feedback`) so precision/recall can be trended.
- **Tune the prompt for the `yes` bucket.** Most false positives likely live
  here (model imposing a "better" disposition on a legitimate human judgment
  call). Tighten taxonomy guidance / raise the evidence bar for re-dispositioning
  a call where a real conversation occurred.
- **Investigate the silent drops** as a reliability item (separate from accuracy).

---

## Changes shipped

### 2026-06-20 — live, DB-driven taxonomy (option 1)

The hardcoded prompt taxonomy was replaced with a live catalog read from Supabase
at eval time, scoped to the dispositions human agents actually use.

- **New table `eavesly_dispositions`** (Eavesly project `miikotqnovnixpeqtqnd`):
  `name, description, visibility, conversation_happened, ai_only, active, source,
  updated_at`. Seeded from the two admin screenshots (15 with definitions) plus
  every distinct value in `eavesly_calls`. **Manually maintained** — Regal is the
  source of truth; there is no auto-sync yet (edit this table in Supabase when
  dispositions change). 45 rows: 24 suggestable, 14 AI-only, 7 inactive.
- **`prompts/disposition-review.txt`**: the static `<disposition_taxonomy>` block
  is now a `{{DISPOSITION_TAXONOMY}}` placeholder.
- **`src/modules/disposition-review/taxonomy.ts`**: `buildDispositionTaxonomy()`
  (human-visible only — excludes `ai_only`) + `renderSystemPrompt()`.
- **`DatabaseService.getActiveDispositions()`** + a `fetch-dispositions` workflow
  step that loads the catalog and passes it into `evaluate()`.
- Falls back to a catalog-less prompt (never an unresolved placeholder) if the DB
  read fails.

Curation notes for the seed (adjust in the table as needed):
- AI-Agent-visibility dispositions → `ai_only=true` (excluded from suggestions).
- `AI *`-prefixed dialer dispositions → `ai_only=true`.
- Lowercase raw AI states / duplicates (`interested`, `qualified`,
  `callback_requested`, …) → `active=false` (catalogued, not suggested).
- Live-only telephony/system outcomes (`Pre-recorded Voicemail`, `No Answer`,
  `Autocomplete`, …) → suggestable, but `visibility`/`description`/
  `conversation_happened` are **null** (not in the screenshots — fill if desired).

**Not yet deployed** — takes effect on the next `wrangler deploy`. After deploy,
re-run query A to measure the flag-rate change.

## Tracking queries

Run on a cadence (weekly suggested). All scoped to `disposition_review`.

### A. Headline metrics (windowed)

```sql
select
  count(*) as total,
  count(*) filter (where has_violation) as violations,
  round(100.0*count(*) filter (where has_violation)/count(*),1) as violation_pct,
  count(*) filter (where alert_sent) as alerts_sent,
  round(avg(processing_time_ms)) as avg_ms,
  round(percentile_cont(0.5) within group (order by processing_time_ms)) as p50_ms,
  round(percentile_cont(0.95) within group (order by processing_time_ms)) as p95_ms,
  max(processing_time_ms) as max_ms,
  round(avg((result_json->>'confidence')::numeric),3) as avg_conf
from eavesly_module_results
where module_name='disposition_review'
  and created_at > now() - interval '7 days';
```

### B. Flag breakdown by scenario

```sql
select
  (result_json->>'conversation_happened') as conv_happened,
  (result_json->>'disposition_matches_transcript')::boolean as matches,
  count(*),
  round(avg((result_json->>'confidence')::numeric),3) as avg_conf
from eavesly_module_results
where module_name='disposition_review'
  and created_at > now() - interval '7 days'
group by 1,2 order by 3 desc;
```

### C. Daily trend

```sql
select
  date_trunc('day', created_at) as day,
  count(*) as evals,
  count(*) filter (where has_violation) as viol,
  round(100.0*count(*) filter (where has_violation)/count(*),1) as viol_pct
from eavesly_module_results
where module_name='disposition_review'
group by 1 order by 1;
```

### D. Most common suggested re-dispositions (where to focus prompt tuning)

```sql
select
  (result_json->>'current_disposition') as current_disp,
  (result_json->>'suggested_disposition') as suggested_disp,
  count(*)
from eavesly_module_results
where module_name='disposition_review'
  and has_violation
  and created_at > now() - interval '7 days'
group by 1,2 order by 3 desc limit 25;
```

### E. Reliability — silent drops (received but never completed)

```sql
select call_id, status, status_code, error_message, created_at
from eavesly_request_log
where endpoint='disposition-review'
  and call_id not in (
    select call_id from eavesly_request_log
    where endpoint='disposition-review' and status='workflow_completed'
  )
order by created_at desc;
```

---

## Snapshot log

| Date (UTC) | Window | Evals | Flag % | Avg conf | conv=no/false | conv=yes/false | Silent drops | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-06-20 02:00 | first ~13h | 1,542 | 61.7% | ~0.95 | 413 | 541 | 9 (~0.6%) | Baseline. Alerts muted same day due to volume. No ground-truth labels yet. |
