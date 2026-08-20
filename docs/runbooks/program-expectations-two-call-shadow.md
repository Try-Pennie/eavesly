# Program Expectations two-call resolver shadow rollout

## Before Worker deployment

Apply `docs/sql/program-expectations-two-call-resolver.sql` outside a transaction because its production-table index is built concurrently. The Worker fails safe to `needs_review` when the evidence table is unavailable, but the migration should land first so prior-call assessments can be cached and audited.

Program Expectations Slack delivery is intentionally muted in `src/services/alerts.ts`. Candidate results still persist with `alert_sent = false`.

## Review the shadow cohort

Decision counts:

```sql
select
  result_json #>> '{decision,status}' as decision,
  result_json #>> '{decision,reason}' as reason,
  count(*)
from public.eavesly_module_results
where module_name = 'program_expectations'
  and created_at >= now() - interval '7 days'
group by 1, 2
order by 1, 2;
```

Prior-call suppressions requiring human validation:

```sql
select call_id, agent_email, created_at, result_json
from public.eavesly_module_results
where module_name = 'program_expectations'
  and result_json #>> '{decision,status}' = 'no_alert_prior_complete'
order by created_at desc;
```

Review every `no_alert_prior_complete` and `needs_review` result during shadow launch. Never export transcript evidence to Slack or logs.

## Promotion gate

Keep Slack muted until at least 100 candidates have been reviewed and all of these hold:

- curated two-call-close controls: 100% suppressed;
- curated genuine omissions: 100% remain `alert_missing`;
- prior-call suppression precision: at least 98%;
- true-violation recall: at least 95%;
- manager-confirmed agent-facing precision: at least 90%.

Promotion requires a separate reviewed change removing both the Program Expectations early return in `src/services/alerts.ts` and the `alert_sent = false` override in `src/workflows/evaluation-workflow.ts`. Deployment remains a separate approval.

## Rollback

Roll back the Worker commit. The evidence table and lead/timestamp index are additive and may remain; they do not send alerts or alter historical module results.
