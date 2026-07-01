-- Regal event joiner (PSAI-195/196/197/198) — shadow-mode ledger + resolver plans.
-- No migration framework in this repo; apply manually in Supabase. NOT auto-applied.

-- Durable ledger of canonical Regal journey events. One row per
-- (regal_task_id, event_type); the resolver joins transcript + completed on
-- regal_task_id. Full payload kept as-is for shadow comparison / replay.
CREATE TABLE IF NOT EXISTS eavesly_regal_call_events (
  regal_task_id   TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,  -- 'transcript_available' | 'call_completed'
  agent_email     TEXT,
  source_event_id TEXT,
  payload         JSONB       NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (regal_task_id, event_type)
);

-- Shadow resolver plans: what the backend resolver WOULD trigger. One per task.
CREATE TABLE IF NOT EXISTS eavesly_regal_resolver_plans (
  regal_task_id     TEXT        NOT NULL PRIMARY KEY,
  enrolled          BOOLEAN     NOT NULL,
  triggered_modules TEXT[]      NOT NULL DEFAULT '{}',
  plan_json         JSONB       NOT NULL,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regal_call_events_task ON eavesly_regal_call_events (regal_task_id);
CREATE INDEX IF NOT EXISTS idx_regal_resolver_plans_enrolled ON eavesly_regal_resolver_plans (enrolled);
