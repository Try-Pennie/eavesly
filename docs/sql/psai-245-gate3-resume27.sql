-- PSAI-245 Gate 3 forward-only resume: authorize exactly the observed stopped state,
-- then permit claims only for the 27 pending manifest ordinals after terminal ordinal 30.
-- This migration is additive: it does not replace the Gate 3 table, rows, functions, or trigger.

begin;

create table if not exists public.eavesly_psai245_resume27_authorization (
  capability_id text primary key check (
    capability_id = 'psai-245-gate-3-resume-pending-after-30-once'
  ),
  approved_digest text not null check (
    approved_digest = '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
  ),
  progress_state_fingerprint text not null check (
    progress_state_fingerprint = 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4'
  ),
  completed_canary_call_id text not null references public.eavesly_calls(call_id),
  manifest_version text not null check (
    manifest_version = 'psai-245-achieve-backfill-manifest-v1'
  ),
  snapshot_cutoff text not null check (
    snapshot_cutoff = '2026-08-11T16:21:44.777859Z'
  ),
  authorized_at timestamptz not null default clock_timestamp()
);

revoke all on table public.eavesly_psai245_resume27_authorization
  from public, anon, authenticated, service_role;

create or replace function public.eavesly_initialize_achieve_backfill_resume27_v1(
  p_call_ids text[],
  p_completed_canary_call_id text,
  p_approved_digest text,
  p_manifest_version text,
  p_snapshot_cutoff text,
  p_progress_state_fingerprint text
)
returns table(status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing_authorization record;
  v_canonical_manifest text;
  v_expected_remaining text[];
  v_stored_remaining text[];
  v_progress_count integer;
  v_completed_count integer;
  v_pending_count integer;
  v_attempted_count integer;
  v_failed_count integer;
  v_failed_ordinal integer;
  v_failed_reason text;
  v_exact_canary_count integer;
  v_guard_trigger_count integer;
  v_exact_gate3_result_count integer;
  v_gate3_capability_result_count integer;
  v_result_conflict_count integer;
  v_authorization_exists boolean := false;
  v_state_canonical text;
  v_actual_fingerprint text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_call_ids is null
     or cardinality(p_call_ids) <> 57
     or (select count(distinct value) from unnest(p_call_ids) ids(value)) <> 57
     or exists (
       select 1 from unnest(p_call_ids) ids(value)
        where value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     )
     or p_call_ids is distinct from array(
       select value from unnest(p_call_ids) ids(value) order by value collate "C"
     )
     or not (p_completed_canary_call_id = any(p_call_ids))
     or p_approved_digest is distinct from '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
     or p_manifest_version is distinct from 'psai-245-achieve-backfill-manifest-v1'
     or p_snapshot_cutoff is distinct from '2026-08-11T16:21:44.777859Z'
     or p_progress_state_fingerprint is distinct from 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4'
  then
    raise exception using errcode = '22023', message = 'invalid PSAI-245 resume-27 initialization';
  end if;

  select '{"candidate_count":57,"candidates":['
         || string_agg(
           '{"call_id":"' || value || '","reason":"approved_frozen_cohort","status":"eligible"}',
           ',' order by ordinal
         )
         || '],"gate":"gate_1_dry_run","module_name":"achieve_welcome_call_qa",'
         || '"representation_version":"psai-245-achieve-backfill-manifest-v1",'
         || '"snapshot":{"cutoff":"2026-08-11T16:21:44.777859Z",'
         || '"funnel_counts":[378,101,89,88,65,57]}}'
    into v_canonical_manifest
    from unnest(p_call_ids) with ordinality ids(value, ordinal);
  if encode(sha256(convert_to(v_canonical_manifest, 'UTF8')), 'hex') is distinct from p_approved_digest then
    raise exception using errcode = '22023', message = 'PSAI-245 resume-27 manifest digest mismatch';
  end if;

  v_expected_remaining := array(
    select value from unnest(p_call_ids) with ordinality ids(value, ordinal)
     where value <> p_completed_canary_call_id order by ordinal
  );
  if cardinality(v_expected_remaining) <> 56
     or (select ordinal from unnest(p_call_ids) with ordinality ids(value, ordinal)
          where value = p_completed_canary_call_id) >= 30
  then
    raise exception using errcode = '22023', message = 'invalid PSAI-245 resume-27 cohort';
  end if;

  lock table public.eavesly_psai245_resume27_authorization in share row exclusive mode;
  select * into v_existing_authorization
    from public.eavesly_psai245_resume27_authorization
   where capability_id = 'psai-245-gate-3-resume-pending-after-30-once';
  if found then
    if v_existing_authorization.approved_digest is distinct from p_approved_digest
       or v_existing_authorization.progress_state_fingerprint is distinct from p_progress_state_fingerprint
       or v_existing_authorization.completed_canary_call_id is distinct from p_completed_canary_call_id
       or v_existing_authorization.manifest_version is distinct from p_manifest_version
       or v_existing_authorization.snapshot_cutoff is distinct from p_snapshot_cutoff
    then
      return query select 'different_authorization'::text;
      return;
    end if;
    v_authorization_exists := true;
  end if;

  if v_authorization_exists then
    -- Replays must still prove the canary and immutable result guard are present.
    lock table public.eavesly_module_results in share mode;
  else
    -- This lock prevents a Gate 3 claim from changing the fingerprint while it is certified.
    lock table public.eavesly_psai245_remaining56_progress in share row exclusive mode;
    lock table public.eavesly_module_results in share mode;
  end if;

  select count(*)::integer into v_exact_canary_count
    from public.eavesly_module_results r
   where r.call_id = p_completed_canary_call_id
     and r.module_name = 'achieve_welcome_call_qa'
     and r.result_json #> '{backfill,audit_only}' = 'true'::jsonb
     and r.result_json #>> '{backfill,approved_digest}' = p_approved_digest
     and r.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
     and r.result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
     and r.result_json #>> '{backfill,canary_call_id}' = p_completed_canary_call_id
     and r.result_json #>> '{backfill,manifest_version}' = p_manifest_version
     and r.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff
     and r.alert_sent is false
     and r.alert_sent_at is null
     and r.processing_time_ms is not null
     and r.processing_time_ms >= 0
     and r.agent_email is null
     and r.contact_name is null
     and r.contact_phone is null
     and r.recording_link is null
     and r.call_summary is null
     and r.transcript_url is null
     and r.sfdc_lead_id is null;

  select count(*)::integer into v_guard_trigger_count
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class guarded_table on guarded_table.oid = t.tgrelid
    join pg_catalog.pg_namespace table_namespace on table_namespace.oid = guarded_table.relnamespace
    join pg_catalog.pg_proc function_definition on function_definition.oid = t.tgfoid
    join pg_catalog.pg_namespace function_namespace on function_namespace.oid = function_definition.pronamespace
   where table_namespace.nspname = 'public'
     and guarded_table.relname = 'eavesly_module_results'
     and t.tgname = 'eavesly_module_results_psai245_remaining56_guard'
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and t.tgtype = 31 -- row-level BEFORE INSERT OR DELETE OR UPDATE
     and function_namespace.nspname = 'public'
     and function_definition.proname = 'eavesly_reject_psai245_remaining56_result_mutation_v1'
     and function_definition.pronargs = 0;

  if v_exact_canary_count <> 1 or v_guard_trigger_count <> 1 then
    return query select 'state_drift'::text;
    return;
  end if;

  if v_authorization_exists then
    return query select 'ready'::text;
    return;
  end if;

  select count(*)::integer,
         array_agg(p.call_id order by p.manifest_ordinal),
         count(*) filter (where p.status = 'completed')::integer,
         count(*) filter (where p.status = 'pending')::integer,
         count(*) filter (where p.status = 'attempted')::integer,
         count(*) filter (where p.status = 'failed')::integer,
         max(p.manifest_ordinal) filter (where p.status = 'failed'),
         max(p.failure_reason) filter (where p.status = 'failed')
    into v_progress_count, v_stored_remaining, v_completed_count, v_pending_count,
         v_attempted_count, v_failed_count, v_failed_ordinal, v_failed_reason
    from public.eavesly_psai245_remaining56_progress p
   where p.approved_digest = p_approved_digest
     and p.completed_canary_call_id = p_completed_canary_call_id;

  if v_progress_count <> 56
     or v_stored_remaining is distinct from v_expected_remaining
     or v_completed_count <> 28
     or v_pending_count <> 27
     or v_attempted_count <> 0
     or v_failed_count <> 1
     or v_failed_ordinal <> 30
     or v_failed_reason is distinct from 'grading_unavailable'
     or exists (
       select 1 from public.eavesly_psai245_remaining56_progress p
        where not (
          (p.manifest_ordinal < 30 and p.status = 'completed')
          or (p.manifest_ordinal = 30 and p.status = 'failed'
              and p.failure_reason = 'grading_unavailable')
          or (p.manifest_ordinal > 30 and p.status = 'pending')
        )
     )
  then
    return query select 'state_drift'::text;
    return;
  end if;

  -- The fingerprint is computed from persisted categories, never accepted as a client assertion.
  v_state_canonical := '{"attempted":' || v_attempted_count
    || ',"completed":' || v_completed_count
    || ',"failed":[{"failure_reason":"' || v_failed_reason
    || '","manifest_ordinal":' || v_failed_ordinal
    || '}],"pending":' || v_pending_count || '}';
  v_actual_fingerprint := encode(sha256(convert_to(v_state_canonical, 'UTF8')), 'hex');
  if v_actual_fingerprint is distinct from p_progress_state_fingerprint then
    return query select 'state_drift'::text;
    return;
  end if;

  -- Every completed progress row must have its one exact immutable Gate 3 audit row; failed
  -- and pending rows must have no Achieve result. Count and correspondence are both certified.
  select count(*) filter (where
           r.result_json #> '{backfill,audit_only}' = 'true'::jsonb
           and r.result_json #>> '{backfill,approved_digest}' = p_approved_digest
           and r.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-3-approved-remaining-56'
           and r.result_json #>> '{backfill,completed_canary_call_id}' = p_completed_canary_call_id
           and r.result_json #>> '{backfill,manifest_version}' = p_manifest_version
           and r.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff
           and r.alert_sent is false
           and r.alert_sent_at is null
           and r.processing_time_ms is not null
           and r.processing_time_ms >= 0
           and r.agent_email is null
           and r.contact_name is null
           and r.contact_phone is null
           and r.recording_link is null
           and r.call_summary is null
           and r.transcript_url is null
           and r.sfdc_lead_id is null
         )::integer,
         count(*)::integer
    into v_exact_gate3_result_count, v_gate3_capability_result_count
    from public.eavesly_module_results r
   where r.module_name = 'achieve_welcome_call_qa'
     and r.result_json #>> '{backfill,capability_id}' = 'psai-245-gate-3-remaining-56-once';
  if v_exact_gate3_result_count <> 28 or v_gate3_capability_result_count <> 28 then
    return query select 'state_drift'::text;
    return;
  end if;

  select count(*)::integer into v_result_conflict_count
    from public.eavesly_psai245_remaining56_progress p
    left join public.eavesly_module_results r
      on r.call_id = p.call_id and r.module_name = 'achieve_welcome_call_qa'
   where (p.status = 'completed' and not (
            r.call_id is not null
            and r.result_json #> '{backfill,audit_only}' = 'true'::jsonb
            and r.result_json #>> '{backfill,approved_digest}' = p_approved_digest
            and r.result_json #>> '{backfill,batch_id}' = 'psai-245-gate-3-approved-remaining-56'
            and r.result_json #>> '{backfill,capability_id}' = 'psai-245-gate-3-remaining-56-once'
            and r.result_json #>> '{backfill,completed_canary_call_id}' = p_completed_canary_call_id
            and r.result_json #>> '{backfill,manifest_version}' = p_manifest_version
            and r.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff
            and r.alert_sent is false and r.alert_sent_at is null
            and r.processing_time_ms is not null and r.processing_time_ms >= 0
            and r.agent_email is null and r.contact_name is null and r.contact_phone is null
            and r.recording_link is null and r.call_summary is null
            and r.transcript_url is null and r.sfdc_lead_id is null
          ))
      or (p.status <> 'completed' and r.call_id is not null);
  if v_result_conflict_count <> 0 then
    return query select 'state_drift'::text;
    return;
  end if;

  insert into public.eavesly_psai245_resume27_authorization (
    capability_id, approved_digest, progress_state_fingerprint,
    completed_canary_call_id, manifest_version, snapshot_cutoff
  ) values (
    'psai-245-gate-3-resume-pending-after-30-once', p_approved_digest,
    p_progress_state_fingerprint, p_completed_canary_call_id,
    p_manifest_version, p_snapshot_cutoff
  );
  return query select 'ready'::text;
end;
$function$;

create or replace function public.eavesly_claim_achieve_backfill_resume27_v1(
  p_call_id text,
  p_approved_digest text,
  p_completed_canary_call_id text,
  p_progress_state_fingerprint text
)
returns table(status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_authorized boolean;
  v_lowest_call_id text;
  v_lowest_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_approved_digest is distinct from '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
     or p_progress_state_fingerprint is distinct from 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4'
  then
    return query select 'rejected'::text;
    return;
  end if;

  select exists (
    select 1 from public.eavesly_psai245_resume27_authorization a
     where a.capability_id = 'psai-245-gate-3-resume-pending-after-30-once'
       and a.approved_digest = p_approved_digest
       and a.progress_state_fingerprint = p_progress_state_fingerprint
       and a.completed_canary_call_id = p_completed_canary_call_id
  ) into v_authorized;
  if not v_authorized then
    return query select 'rejected'::text;
    return;
  end if;

  -- Lock the single ordering authority. An attempted or failed lowest unfinished row remains
  -- the lowest row and therefore blocks every later ordinal from being claimed.
  select progress.call_id, progress.status
    into v_lowest_call_id, v_lowest_status
    from public.eavesly_psai245_remaining56_progress progress
   where progress.manifest_ordinal > 30
     and progress.status <> 'completed'
     and progress.approved_digest = p_approved_digest
     and progress.completed_canary_call_id = p_completed_canary_call_id
   order by progress.manifest_ordinal
   limit 1
   for update;

  -- Completed requests are replay observations only; they never claim or alter a row.
  if v_lowest_call_id is null or v_lowest_call_id is distinct from p_call_id then
    if exists (
      select 1 from public.eavesly_psai245_remaining56_progress requested
       where requested.call_id = p_call_id
         and requested.manifest_ordinal > 30
         and requested.status = 'completed'
         and requested.approved_digest = p_approved_digest
         and requested.completed_canary_call_id = p_completed_canary_call_id
    ) then
      return query select 'completed'::text;
    end if;
    return query select 'rejected'::text;
    return;
  end if;

  if v_lowest_status is distinct from 'pending' then
    return query select v_lowest_status;
    return;
  end if;

  update public.eavesly_psai245_remaining56_progress as progress
     set status = 'attempted', attempted_at = clock_timestamp()
   where progress.call_id = v_lowest_call_id
     and progress.status = 'pending'
  returning 'claimed' into v_lowest_status;
  return query select coalesce(v_lowest_status, 'rejected');
end;
$function$;

-- Once this migration is applied, all service-role grading claims must pass through the
-- certified sequential resume RPC. Finalization and terminal-failure persistence remain available.
revoke execute on function public.eavesly_claim_achieve_backfill_remaining56_v1(
  text,text,text
) from service_role;

revoke all on function public.eavesly_initialize_achieve_backfill_resume27_v1(
  text[],text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.eavesly_claim_achieve_backfill_resume27_v1(
  text,text,text,text
) from public, anon, authenticated;
grant execute on function public.eavesly_initialize_achieve_backfill_resume27_v1(
  text[],text,text,text,text,text
) to service_role;
grant execute on function public.eavesly_claim_achieve_backfill_resume27_v1(
  text,text,text,text
) to service_role;

commit;
