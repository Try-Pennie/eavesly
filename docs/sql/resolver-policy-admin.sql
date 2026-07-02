-- Resolver policy admin (PSAI-202) — DB-backed policy + module prompt mirror for QVV.
-- No migration framework in this repo; apply manually in Supabase. NOT auto-applied.

-- Append-only versioned resolver policy. Latest row (max id) is the active policy.
-- Rollback = insert a copy of an older row's policy_json as a new row.
CREATE TABLE IF NOT EXISTS eavesly_resolver_policies (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_json    JSONB       NOT NULL,
  created_by     TEXT        NOT NULL,
  change_summary TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE eavesly_resolver_policies ENABLE ROW LEVEL SECURITY;

-- Any signed-in QVV user may read; only god-mode managers may write.
-- (Worker uses the service role and bypasses RLS.)
CREATE POLICY resolver_policies_select ON eavesly_resolver_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY resolver_policies_insert_god_mode ON eavesly_resolver_policies
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM manager_coaching_prompts m
    WHERE m.manager_email = (auth.jwt() ->> 'email') AND m.is_god_mode
  ));

-- Seed version 1 from the code default so the UI always has an active policy.
INSERT INTO eavesly_resolver_policies (policy_json, created_by, change_summary)
VALUES (
  '{"enrollmentDisposition":"1.4 - Converted/Won > END CAMPAIGNS","enrollmentMinDurationSeconds":1200,"excludedCampaignFriendlyIds":[],"warmTransferLegalStateValue":"No","collectionsMinBalance":1}',
  'system',
  'Seed from DEFAULT_RESOLVER_POLICY (PSAI-202)'
);

-- Read-only mirror of the deployed module prompts, synced by the Worker's
-- POST /api/v1/admin/prompts/sync endpoint. QVV renders these; editing stays in this repo.
CREATE TABLE IF NOT EXISTS eavesly_module_prompts (
  module_name  TEXT        PRIMARY KEY,
  prompt_text  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE eavesly_module_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY module_prompts_select ON eavesly_module_prompts
  FOR SELECT TO authenticated USING (true);
