# PSAI-245 Gate 3 — exact remaining 56 once

This is a separately deployed and separately invoked audit-only capability. It accepts only the complete approved 57-call Gate 1 manifest/digest plus exact provenance for the already completed Gate 2 canary. It can never select a new cohort, process the canary, send alerts, attach customer metadata, use the generic evaluation Workflow, or write ordinary metrics.

Approved digest:

```text
01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e
```

Endpoint:

```text
POST /api/v1/admin/achieve-welcome-call-qa/backfill/remaining-56
```

The authenticated JSON command is the owner-only saved Gate 1 `manifest` and `digest` plus:

```json
{
  "completed_canary": {
    "call_id": "the call ID on the completed canary row",
    "audit_only": true,
    "approved_digest": "01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e",
    "batch_id": "psai-245-gate-2-approved-manifest",
    "canary_id": "psai-245-gate-2-one-call-canary",
    "manifest_version": "psai-245-achieve-backfill-manifest-v1",
    "snapshot_cutoff": "2026-08-11T16:21:44.777859Z"
  }
}
```

Do not put the manifest, IDs, transcripts, or command in tickets, chat, shell history, shared logs, or this repository. Store command/response files mode `0600`. The schema rejects unknown/private fields. Responses and Workflow outputs contain only digest, fixed counts, ordinals, and categorical states.

## Why a Workflow replay cannot duplicate an LLM attempt

The Worker privately loads the transcript and verifies a bounded, gradeable Achieve segment first. It emits neither value. Immediately before the LLM call, `eavesly_claim_achieve_backfill_remaining56_v1` atomically changes the item from `pending` to irreversible `attempted`. Every replay of that ordinal sees `attempted`, `failed`, or `completed` and cannot send another LLM request. A crash before the claim can safely replay. A crash after the claim can leave a terminal `attempted` item with an **unknown provider outcome**. This protects at-most-one application attempt but cannot guarantee completion. Final result insert plus `completed` transition is one database transaction and uses plain `INSERT`.

Gate 3 has a dedicated LLM client: no application `withRetry`, OpenAI SDK `maxRetries: 0`, OpenRouter `provider.allow_fallbacks: false`, and categorical-only invalid-response/error logging. The Workflow uses `retries.limit: 0`, matching the production-proven Gate 2 configuration. No interpretation of that field establishes safety: `NonRetryableError` and the durable database claim are authoritative for application replay protection.

**Mandatory execution-time AI Gateway prerequisite:** recheck that Gateway retries and every Gateway fallback/failover route remain disabled for this request path. Capture private configuration evidence during change review. OpenRouter provider fallback is disabled in the request, but Gateway behavior remains an independent operational boundary. If Gateway configuration cannot be verified, do not execute: strict at-most-one provider outbound attempt cannot be claimed.

## Rollout

1. Confirm the exact Gate 2 canary row exists once and record its ID privately. Confirm no ordinary or other audit result exists for any manifest member.
2. In a maintenance window, apply `docs/sql/psai-245-gate3-remaining56.sql`. Do **not** initialize or invoke yet. Initialization later takes brief write-blocking locks on progress/results and a share lock on calls while it verifies the exact cohort and creates 56 rows; ordinary result writers may wait during that short transaction.
3. Run `npm run test:psai245-gate3-db`, focused tests, `npm run typecheck`, `npm test`, and the production Wrangler dry-run.
4. Verify and record privately that AI Gateway retries and all fallback/failover routes are disabled. Stop if this is not provable.
5. Deploy configuration with the separate `ACHIEVE_BACKFILL_REMAINING56_WORKFLOW` binding. Verify health and binding inventory without posting the command.
6. Obtain separate execution approval that explicitly accepts terminal-partial/unknown semantics. POST the command exactly once. A retry can only resolve to the same deterministic Workflow ID.
7. Observe with ordinal/categorical SQL only:

```sql
select manifest_ordinal, status, failure_reason
from public.eavesly_psai245_remaining56_progress
order by manifest_ordinal;

select status, count(*)
from public.eavesly_psai245_remaining56_progress
group by status
order by status;
```

The desired clean outcome is 56 `completed` progress rows and exactly 56 Gate 3 immutable result rows, in addition to the unchanged Gate 2 canary. It is not guaranteed: a crash or ambiguous provider response after claim leaves a terminal `attempted` ordinal and the run stops as partial/unknown.

The migration installs a permanent row trigger on `eavesly_module_results`, adding a small predicate/query cost to every insert, update, and delete while Gate 3 protections remain installed. Reservation applies only to `achieve_welcome_call_qa` rows for the 56 progress call IDs: it rejects ordinary or direct-shaped Achieve writes outside the finalizer. Unrelated module writes on those call IDs bypass the reservation guard. Completed Gate 3 Achieve rows remain immutable.

## Stop and resume rules

The Workflow stops on the first result other than `completed`/exact replayed completion. It never processes later ordinals after a transcript/segment, claim, grading, finalization, or failure-persistence anomaly, and never reports `completed` when an anomaly occurred. Pause/terminate immediately if authorization, initialization, canary provenance, cohort conflict, migration, binding, or digest checks fail; if any output contains private content; if alert/ordinary metric traffic is observed; or if the immutable/reservation trigger rejects the expected finalizer. Do not create another Workflow ID, alter progress, delete results, or regrade an `attempted`, `failed`, or `completed` ordinal.

If categorical failure persistence itself fails, classify the run `stopped` with outcome unknown; do not assume the failure row exists. For an operational stop, pause the one deterministic instance:

```bash
npx wrangler workflows instances pause eavesly-achieve-backfill-remaining56-production \
  psai-245-gate-3-remaining-56-once-01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e \
  --env production
```

After review, resume that instance only when no terminal anomaly exists. If Cloudflare marks it failed, restarting the same instance ID is safe from duplicate application sends, but it will stop again upon reaching an `attempted` or `failed` ordinal; it does not promise to continue to later pending rows. There is intentionally no skip/reset/regrade interface:

```bash
npx wrangler workflows instances resume eavesly-achieve-backfill-remaining56-production INSTANCE_ID --env production
npx wrangler workflows instances restart eavesly-achieve-backfill-remaining56-production INSTANCE_ID --env production
```

Never use a new ID to work around an instance state. A terminal anomaly means the run outcome is partial/unknown and requires user review of whether that semantic trade-off is acceptable; this implementation does not provide a completion-guaranteed recovery path.

## Rollback

Before initialization, rollback is allowed only after removing/rolling back the Worker binding and verifying the progress table is empty. Use this exact order:

```sql
begin;

do $$
begin
  if exists (select 1 from public.eavesly_psai245_remaining56_progress) then
    raise exception 'Gate 3 progress exists; rollback forbidden';
  end if;
end $$;

drop trigger if exists eavesly_module_results_psai245_remaining56_guard
  on public.eavesly_module_results;
drop function if exists public.eavesly_reject_psai245_remaining56_result_mutation_v1();
drop function if exists public.eavesly_initialize_achieve_backfill_remaining56_v1(text[],text,text,text,text);
drop function if exists public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text);
drop function if exists public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text);
drop function if exists public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text);
drop table if exists public.eavesly_psai245_remaining56_progress;
commit;
```

Once any progress row exists, routine database rollback is forbidden because removing durable claims would make at-most-one grading unprovable. Roll back only Worker execution by pause/terminate; preserve progress, canary, and all Gate 3 audit rows immutably. Recovery after initialization is forward-only and requires a separately reviewed migration that never resets attempted states or mutates/deletes audit rows.
