# PSAI-245 Gate 3 — forward-only resume of the 27 untouched pending calls

This is a separately deployed and separately invoked continuation of Gate 3. It exists only for the observed stopped production state:

- 28 progress rows `completed` before manifest ordinal 30 (the completed Gate 2 canary is not a progress row)
- manifest ordinal 30 terminal `failed:grading_unavailable`
- 27 progress rows `pending` at ordinals 31 through 57
- zero `attempted` rows

It never resets, deletes, updates, skips, prepares, claims, or grades ordinal 30 or an earlier ordinal. It has no request field or database RPC for selecting an ordinal, resetting progress, skipping a row, or regrading a failed/completed row.

Approved immutable artifacts:

```text
manifest SHA-256: 01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e
state SHA-256:    ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4
```

The state fingerprint canonicalization is `psai-245-resume-progress-state-v1`, the SHA-256 of this exact categorical UTF-8 JSON:

```json
{"attempted":0,"completed":28,"failed":[{"failure_reason":"grading_unavailable","manifest_ordinal":30}],"pending":27}
```

The database reconstructs this value from locked progress rows and also verifies exact ordinal placement, exact cohort identity, exact immutable Gate 3 result provenance, no result for failed/pending rows, no customer metadata, and `alert_sent=false`. A matching client-supplied fingerprint is not accepted as proof.

Endpoint:

```text
POST /api/v1/admin/achieve-welcome-call-qa/backfill/resume-27
```

The strict authenticated JSON command is the original owner-only Gate 3 command plus:

```json
{
  "progress_state_fingerprint": {
    "algorithm": "SHA-256",
    "canonicalization": "psai-245-resume-progress-state-v1",
    "value": "ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4"
  }
}
```

Do not place the manifest, call IDs, command, transcripts, or result content in tickets, chat, logs, shell history, or this repository. Keep request/response files mode `0600`. HTTP responses, Workflow outputs, and durable step outputs contain only fixed counts, ordinals, digests/fingerprints, and categorical states.

## Safety design

`docs/sql/psai-245-gate3-resume27.sql` is additive. It preserves the Gate 3 progress rows, result rows, immutable/reservation trigger, and Gate 3 functions. It revokes `service_role` execution of the superseded `eavesly_claim_achieve_backfill_remaining56_v1` so it cannot bypass certification or claim a later ordinal; the existing finalization and failure RPCs remain executable. Initialization briefly locks progress/results and independently verifies the exact metadata-free Gate 2 canary provenance, the enabled Gate 3 trigger's table/function identity, all 28 exact completed Gate 3 audit rows, no result for failed/pending rows, and the exact stopped progress state before inserting one immutable authorization record. Concurrent initialization is idempotent.

Only `eavesly_claim_achieve_backfill_resume27_v1` remains available to `service_role` for new claims. Its guarded update requires:

- the immutable authorization record;
- exact digest, canary, and state fingerprint;
- membership in the existing Gate 3 progress cohort;
- manifest ordinal greater than 30;
- identity as the lowest unfinished ordinal greater than 30; and
- current status `pending`.

The claim RPC locks that lowest unfinished row before deciding. If it is `attempted` or `failed`, every later ordinal is rejected; concurrent claims for an early and late ordinal cannot both succeed. The Workflow processes ordinals 31 through 57 sequentially. For each item it privately prepares the bounded Achieve segment, atomically claims immediately before one LLM send, then uses the unchanged Gate 3 audit-only finalizer. The result has `alert_sent=false`, all customer/alert metadata columns null, and only audit provenance in `result_json.backfill`. It never enters generic evaluation, alert, or ordinary-metrics paths.

The one-shot settings are unchanged: no application retry, OpenAI SDK `maxRetries: 0`, OpenRouter `provider.allow_fallbacks: false`, Workflow `retries.limit: 0`, and `NonRetryableError` step translation. The durable database claim remains the replay authority. A crash after claim can leave terminal `attempted` with unknown provider outcome; never regrade it.

The distinct deterministic Workflow ID is compact enough for Cloudflare's 64-character limit:

```text
psai245-r27-<first-16-of-approved-digest>-<first-16-of-state-fingerprint>
```

Both complete hashes remain required and independently validated in the request and database authorization. The compact ID is only a deterministic replay key. A repeated POST resolves only to that same ID.

## Pre-deployment verification (safe/local only)

```bash
npm test -- --run \
  src/services/achieve-backfill-resume27.test.ts \
  src/services/achieve-backfill-resume27-adapter.test.ts \
  src/workflows/achieve-backfill-resume27-workflow.test.ts \
  src/routes/achieve-backfill-resume27-admin.test.ts \
  src/services/achieve-backfill-one-shot-llm.test.ts
npm run test:psai245-resume27-db
npm run typecheck
npm test
npx wrangler deploy --dry-run --env production --outdir /tmp/eavesly-psai245-resume27-dry-run
```

Before any production execution, privately verify AI Gateway retries and every fallback/failover route are disabled for this request path. If that cannot be proved, do not execute.

## Production rollout (requires separate approval; not performed by implementation work)

1. Record private preflight evidence that the exact categorical state above exists and no alert/customer metadata was written. Stop on any mismatch.
2. Apply `docs/sql/psai-245-gate3-resume27.sql` in a maintenance window. Do not invoke yet.
3. Verify the original Gate 3 trigger remains enabled on `eavesly_module_results`, points to `eavesly_reject_psai245_remaining56_result_mutation_v1`, and all 56 progress rows are unchanged by migration application. Compare semantic trigger identity/definition, not catalog OIDs.
4. Deploy the separate `ACHIEVE_BACKFILL_RESUME27_WORKFLOW` binding and verify binding inventory/health.
5. Reconfirm AI Gateway no-retry/no-fallback configuration and obtain explicit execution approval accepting terminal partial/unknown semantics.
6. POST the exact command file once. Do not invent a new Workflow ID.
7. Observe categorical/ordinal state only:

```sql
select manifest_ordinal, status, failure_reason
from public.eavesly_psai245_remaining56_progress
where manifest_ordinal >= 30
order by manifest_ordinal;

select status, count(*)
from public.eavesly_psai245_remaining56_progress
group by status
order by status;
```

The desired clean outcome is exactly 55 progress rows `completed`, ordinal 30 as the one `failed:grading_unavailable` row, zero pending/attempted rows, and exactly 55 corresponding Gate 3 audit rows satisfying audit-only/no-alert/no-metadata provenance. The separate exact Gate 2 canary remains unchanged, for 56 total Achieve result rows.

## Stop rules

The Workflow stops on the first new transcript, segment, claim, grading, finalization, failure-persistence, state, digest, fingerprint, or runtime anomaly. It does not prepare a later ordinal after that anomaly.

Immediately stop and review if:

- initialization returns `state_drift` or `different_authorization`;
- ordinal 30 or any earlier ordinal appears in resume step output;
- any alert, ordinary metric, customer metadata, ID, transcript, or result content appears in output;
- any item receives evidence of more than one provider attempt; or
- the original Gate 3 trigger/rows differ unexpectedly.

Do not reset/regrade an `attempted`, `failed`, or `completed` row. Do not mutate/skip ordinal 30. Do not create another resume capability or Workflow ID to bypass a stop. A new anomaly is terminal partial/unknown and requires separate user review.

For an operational pause, use only the deterministic resume instance:

```bash
npx wrangler workflows instances pause eavesly-achieve-backfill-resume27-production INSTANCE_ID --env production
```

## Rollback

Before initialization, remove the Worker binding first and verify the authorization table is empty. Only then the additive database objects may be removed. This default rollback deliberately leaves the superseded Gate 3 claim RPC disabled:

```sql
begin;
do $$
begin
  if exists (select 1 from public.eavesly_psai245_resume27_authorization) then
    raise exception 'resume-27 authorization exists; database rollback forbidden';
  end if;
end $$;
drop function if exists public.eavesly_claim_achieve_backfill_resume27_v1(text,text,text,text);
drop function if exists public.eavesly_initialize_achieve_backfill_resume27_v1(text[],text,text,text,text,text);
drop table if exists public.eavesly_psai245_resume27_authorization;
commit;
```

Before authorization only, restoring `service_role` execution of the superseded claim RPC is optional and is **not** part of routine rollback. It is safe only after confirming the resume binding/instances are absent, the authorization table was and remains empty, no progress/result state changed since migration application, and a separate reviewer explicitly approves restoring the old Gate 3 behavior. Under those conditions only:

```sql
grant execute on function public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text)
  to service_role;
```

After authorization exists, database rollback is forbidden and the superseded claim must never be re-granted. Disable/pause only Worker execution and preserve the authorization, all progress rows, ordinal 30, all claims, the Gate 3 trigger, and all audit rows. There is never a rollback step that updates/deletes progress or results.
