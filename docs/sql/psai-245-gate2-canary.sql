-- PSAI-245 Gate 2: immutable, one-call-only Achieve backfill finalization.
-- Apply and verify this migration before deploying or invoking the Worker route.
-- The RPC transaction is intentionally short: the Worker performs the LLM call
-- first, then this function locks, final-rechecks all 57 IDs, and plain-inserts.

begin;

create unique index if not exists eavesly_module_results_psai245_canary_digest_uidx
  on public.eavesly_module_results (
    (result_json #>> '{backfill,approved_digest}'),
    (result_json #>> '{backfill,canary_id}')
  )
  where module_name = 'achieve_welcome_call_qa'
    and result_json #> '{backfill,audit_only}' = 'true'::jsonb
    and result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
    and result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary';

create or replace function public.eavesly_reject_psai245_canary_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PSAI-245 audit canary result is immutable';
end;
$function$;

revoke all on function public.eavesly_reject_psai245_canary_mutation_v1() from public;

drop trigger if exists eavesly_module_results_psai245_canary_immutable
  on public.eavesly_module_results;
create trigger eavesly_module_results_psai245_canary_immutable
before update or delete on public.eavesly_module_results
for each row
when (
  old.module_name = 'achieve_welcome_call_qa'
  and old.result_json #> '{backfill,audit_only}' = 'true'::jsonb
  and old.result_json #>> '{backfill,approved_digest}' = '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
  and old.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
  and old.result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
)
execute function public.eavesly_reject_psai245_canary_mutation_v1();

create or replace function public.eavesly_finalize_achieve_backfill_canary_v1(
  p_call_ids text[],
  p_canary_call_id text,
  p_result_json jsonb,
  p_has_violation boolean,
  p_violation_type text,
  p_processing_time_ms integer,
  p_approved_digest text,
  p_manifest_version text,
  p_snapshot_cutoff text
)
returns table(status text, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_known_count integer;
  v_ordinary_count integer;
  v_different_audit_count integer;
  v_exact_same_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if p_call_ids is null
     or cardinality(p_call_ids) <> 57
     or (select count(distinct value) from unnest(p_call_ids) as ids(value)) <> 57
     or p_canary_call_id is null
     or not (p_canary_call_id = any(p_call_ids))
     or p_approved_digest is distinct from '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
     or p_manifest_version is distinct from 'psai-245-achieve-backfill-manifest-v1'
     or p_snapshot_cutoff is distinct from '2026-08-11T16:21:44.777859Z'
     or p_processing_time_ms is null
     or p_processing_time_ms < 0
     or p_result_json #> '{backfill,audit_only}' is distinct from 'true'::jsonb
     or p_result_json #>> '{backfill,approved_digest}' is distinct from p_approved_digest
     or p_result_json #>> '{backfill,batch_id}' is distinct from 'psai-245-gate-2-approved-manifest'
     or p_result_json #>> '{backfill,canary_id}' is distinct from 'psai-245-gate-2-one-call-canary'
     or p_result_json #>> '{backfill,canary_call_id}' is distinct from p_canary_call_id
     or p_result_json #>> '{backfill,manifest_version}' is distinct from p_manifest_version
     or p_result_json #>> '{backfill,snapshot_cutoff}' is distinct from p_snapshot_cutoff
  then
    raise exception using errcode = '22023', message = 'invalid PSAI-245 canary finalization';
  end if;

  -- Blocks ordinary INSERT/UPSERT writers only for this short final check+insert
  -- transaction. No network or LLM operation is performed while this lock is held.
  lock table public.eavesly_module_results in share row exclusive mode;
  lock table public.eavesly_calls in share mode;

  select count(distinct calls.call_id)::integer
    into v_known_count
    from public.eavesly_calls as calls
   where calls.call_id = any(p_call_ids);
  if v_known_count <> 57 then
    return query select 'rejected'::text, 'unknown_call_ids'::text;
    return;
  end if;

  select count(*)::integer
    into v_ordinary_count
    from public.eavesly_module_results as results
   where results.module_name = 'achieve_welcome_call_qa'
     and results.call_id = any(p_call_ids)
     and results.result_json #> '{backfill,audit_only}' is distinct from 'true'::jsonb;
  if v_ordinary_count > 0 then
    return query select 'rejected'::text, 'ordinary_results_exist'::text;
    return;
  end if;

  select count(*)::integer
    into v_different_audit_count
    from public.eavesly_module_results as results
   where results.module_name = 'achieve_welcome_call_qa'
     and results.call_id = any(p_call_ids)
     and results.result_json #> '{backfill,audit_only}' = 'true'::jsonb
     and not (
       results.call_id = p_canary_call_id
       and results.result_json #>> '{backfill,approved_digest}' = p_approved_digest
       and results.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
       and results.result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
       and results.result_json #>> '{backfill,canary_call_id}' = p_canary_call_id
       and results.result_json #>> '{backfill,manifest_version}' = p_manifest_version
       and results.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff
     );
  if v_different_audit_count > 0 then
    return query select 'rejected'::text, 'different_audit_provenance'::text;
    return;
  end if;

  select count(*)::integer
    into v_exact_same_count
    from public.eavesly_module_results as results
   where results.call_id = p_canary_call_id
     and results.module_name = 'achieve_welcome_call_qa'
     and results.result_json #> '{backfill,audit_only}' = 'true'::jsonb
     and results.result_json #>> '{backfill,approved_digest}' = p_approved_digest
     and results.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
     and results.result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
     and results.result_json #>> '{backfill,canary_call_id}' = p_canary_call_id
     and results.result_json #>> '{backfill,manifest_version}' = p_manifest_version
     and results.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff;
  if v_exact_same_count = 1 then
    return query select 'already_completed'::text, null::text;
    return;
  end if;

  -- Plain INSERT only. Existing (call_id,module_name) and the partial digest
  -- index are defense-in-depth; neither conflict path updates an existing row.
  begin
    insert into public.eavesly_module_results (
      call_id,
      module_name,
      result_json,
      has_violation,
      violation_type,
      alert_sent,
      alert_sent_at,
      processing_time_ms
    ) values (
      p_canary_call_id,
      'achieve_welcome_call_qa',
      p_result_json,
      p_has_violation,
      p_violation_type,
      false,
      null,
      p_processing_time_ms
    );
  exception when unique_violation then
    -- A same-digest row outside this approved cohort, or a conflicting ordinary
    -- row, must not be treated as idempotent completion.
    return query select 'rejected'::text, 'canary_already_used'::text;
    return;
  end;

  return query select 'inserted'::text, null::text;
end;
$function$;

revoke all on function public.eavesly_finalize_achieve_backfill_canary_v1(
  text[], text, jsonb, boolean, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.eavesly_finalize_achieve_backfill_canary_v1(
  text[], text, jsonb, boolean, text, integer, text, text, text
) to service_role;

commit;
