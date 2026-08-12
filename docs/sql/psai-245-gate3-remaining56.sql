-- PSAI-245 Gate 3: one irreversible grading claim and one immutable audit insert
-- for each of the exact approved manifest's 56 non-canary calls.
-- Requires the Gate 2 migration and one exact completed canary row.

begin;

create table if not exists public.eavesly_psai245_remaining56_progress (
  call_id text primary key references public.eavesly_calls(call_id),
  manifest_ordinal integer not null unique check (manifest_ordinal between 1 and 57),
  approved_digest text not null check (approved_digest = '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'),
  completed_canary_call_id text not null,
  status text not null check (status in ('pending', 'attempted', 'completed', 'failed')),
  failure_reason text check (failure_reason in (
    'grading_unavailable', 'invalid_response', 'write_unavailable'
  )),
  attempted_at timestamptz,
  completed_at timestamptz,
  check (
    (status = 'pending' and attempted_at is null and completed_at is null and failure_reason is null)
    or (status = 'attempted' and attempted_at is not null and completed_at is null and failure_reason is null)
    or (status = 'completed' and attempted_at is not null and completed_at is not null and failure_reason is null)
    or (status = 'failed' and attempted_at is not null and completed_at is not null and failure_reason is not null)
  ),
  check (call_id <> completed_canary_call_id)
);

revoke all on table public.eavesly_psai245_remaining56_progress from public, anon, authenticated, service_role;

create or replace function public.eavesly_reject_psai245_remaining56_result_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reserved boolean;
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.module_name = 'achieve_welcome_call_qa'
     and old.result_json #>> '{backfill,capability_id}' = 'psai-245-gate-3-remaining-56-once'
  then
    raise exception using errcode = '55000', message = 'PSAI-245 remaining-56 audit result is immutable';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select exists (
      select 1 from public.eavesly_psai245_remaining56_progress p where p.call_id = new.call_id
    ) into v_reserved;
    if v_reserved
       and new.module_name = 'achieve_welcome_call_qa'
       and not (
      current_setting('eavesly.psai245_remaining_finalize', true) is not distinct from 'on'
      and new.result_json #> '{backfill,audit_only}' is not distinct from 'true'::jsonb
      and new.result_json #>> '{backfill,approved_digest}' is not distinct from '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'
      and new.result_json #>> '{backfill,batch_id}' is not distinct from 'psai-245-gate-3-approved-remaining-56'
      and new.result_json #>> '{backfill,capability_id}' is not distinct from 'psai-245-gate-3-remaining-56-once'
      and new.alert_sent is false
      and new.alert_sent_at is null
      and new.agent_email is null
      and new.contact_name is null
      and new.contact_phone is null
      and new.recording_link is null
      and new.call_summary is null
      and new.transcript_url is null
      and new.sfdc_lead_id is null
    ) then
      raise exception using errcode = '55000', message = 'PSAI-245 remaining-56 call is reserved for audit-only finalization';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.eavesly_reject_psai245_remaining56_result_mutation_v1() from public, anon, authenticated, service_role;

drop trigger if exists eavesly_module_results_psai245_remaining56_guard on public.eavesly_module_results;
create trigger eavesly_module_results_psai245_remaining56_guard
before insert or update or delete on public.eavesly_module_results
for each row execute function public.eavesly_reject_psai245_remaining56_result_mutation_v1();

create or replace function public.eavesly_initialize_achieve_backfill_remaining56_v1(
  p_call_ids text[],
  p_completed_canary_call_id text,
  p_approved_digest text,
  p_manifest_version text,
  p_snapshot_cutoff text
)
returns table(status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_known_count integer;
  v_exact_canary_count integer;
  v_conflict_count integer;
  v_progress_count integer;
  v_expected_remaining text[];
  v_stored_remaining text[];
  v_canonical_manifest text;
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
  then
    raise exception using errcode = '22023', message = 'invalid PSAI-245 remaining-56 initialization';
  end if;

  -- Reconstruct the exact canonical Gate 1 manifest. The ID grammar excludes
  -- JSON escaping characters, so this binds the service-role RPC to the same
  -- 57 IDs as the approved SHA-256 digest rather than trusting the digest label.
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
    raise exception using errcode = '22023', message = 'PSAI-245 remaining-56 manifest digest mismatch';
  end if;

  v_expected_remaining := array(
    select value from unnest(p_call_ids) with ordinality ids(value, ordinal)
     where value <> p_completed_canary_call_id order by ordinal
  );
  if cardinality(v_expected_remaining) <> 56 then
    raise exception using errcode = '22023', message = 'invalid PSAI-245 remaining-56 cohort';
  end if;

  lock table public.eavesly_psai245_remaining56_progress in share row exclusive mode;
  lock table public.eavesly_module_results in share row exclusive mode;
  lock table public.eavesly_calls in share mode;

  select count(distinct call_id)::integer into v_known_count
    from public.eavesly_calls where call_id = any(p_call_ids);
  if v_known_count <> 57 then return query select 'cohort_conflict'::text; return; end if;

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
     and r.result_json #>> '{backfill,snapshot_cutoff}' = p_snapshot_cutoff;
  if v_exact_canary_count <> 1 then return query select 'completed_canary_missing'::text; return; end if;

  select count(*)::integer into v_conflict_count
    from public.eavesly_module_results r
   where r.call_id = any(p_call_ids)
     and r.module_name = 'achieve_welcome_call_qa'
     and not (
       r.call_id = p_completed_canary_call_id
       and r.result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
       and r.result_json #>> '{backfill,approved_digest}' = p_approved_digest
     );
  if v_conflict_count > 0 then return query select 'cohort_conflict'::text; return; end if;

  select count(*)::integer,
         array_agg(call_id order by manifest_ordinal)
    into v_progress_count, v_stored_remaining
    from public.eavesly_psai245_remaining56_progress;
  if v_progress_count > 0 then
    if v_progress_count = 56 and v_stored_remaining = v_expected_remaining then
      return query select 'ready'::text;
    else
      return query select 'different_progress'::text;
    end if;
    return;
  end if;

  insert into public.eavesly_psai245_remaining56_progress (
    call_id, manifest_ordinal, approved_digest, completed_canary_call_id, status
  )
  select value, ordinal::integer, p_approved_digest, p_completed_canary_call_id, 'pending'
    from unnest(p_call_ids) with ordinality ids(value, ordinal)
   where value <> p_completed_canary_call_id;
  return query select 'ready'::text;
end;
$function$;

create or replace function public.eavesly_claim_achieve_backfill_remaining56_v1(
  p_call_id text, p_approved_digest text, p_completed_canary_call_id text
)
returns table(status text)
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare v_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501', message='service role required'; end if;
  update public.eavesly_psai245_remaining56_progress as progress
     set status = 'attempted', attempted_at = clock_timestamp()
   where progress.call_id = p_call_id and progress.status = 'pending'
     and progress.approved_digest = p_approved_digest
     and progress.completed_canary_call_id = p_completed_canary_call_id
  returning 'claimed' into v_status;
  if v_status = 'claimed' then return query select v_status; return; end if;
  select p.status into v_status from public.eavesly_psai245_remaining56_progress p
   where p.call_id = p_call_id and p.approved_digest = p_approved_digest
     and p.completed_canary_call_id = p_completed_canary_call_id;
  return query select coalesce(v_status, 'rejected');
end;
$function$;

create or replace function public.eavesly_finalize_achieve_backfill_remaining56_v1(
  p_call_id text, p_result_json jsonb, p_has_violation boolean, p_violation_type text,
  p_processing_time_ms integer, p_approved_digest text, p_completed_canary_call_id text
)
returns table(status text)
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare v_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501', message='service role required'; end if;
  select p.status into v_status from public.eavesly_psai245_remaining56_progress p
   where p.call_id = p_call_id and p.approved_digest = p_approved_digest
     and p.completed_canary_call_id = p_completed_canary_call_id for update;
  if v_status = 'completed' then return query select 'already_completed'::text; return; end if;
  if v_status is distinct from 'attempted'
     or p_processing_time_ms is null or p_processing_time_ms < 0
     or p_result_json #> '{backfill,audit_only}' is distinct from 'true'::jsonb
     or p_result_json #>> '{backfill,approved_digest}' is distinct from p_approved_digest
     or p_result_json #>> '{backfill,batch_id}' is distinct from 'psai-245-gate-3-approved-remaining-56'
     or p_result_json #>> '{backfill,capability_id}' is distinct from 'psai-245-gate-3-remaining-56-once'
     or p_result_json #>> '{backfill,completed_canary_call_id}' is distinct from p_completed_canary_call_id
     or p_result_json #>> '{backfill,manifest_version}' is distinct from 'psai-245-achieve-backfill-manifest-v1'
     or p_result_json #>> '{backfill,snapshot_cutoff}' is distinct from '2026-08-11T16:21:44.777859Z'
  then return query select 'rejected'::text; return; end if;

  perform set_config('eavesly.psai245_remaining_finalize', 'on', true);
  begin
    insert into public.eavesly_module_results (
      call_id, module_name, result_json, has_violation, violation_type, alert_sent,
      alert_sent_at, processing_time_ms, agent_email, contact_name, contact_phone,
      recording_link, call_summary, transcript_url, sfdc_lead_id
    ) values (
      p_call_id, 'achieve_welcome_call_qa', p_result_json, p_has_violation,
      p_violation_type, false, null, p_processing_time_ms, null, null, null, null, null, null, null
    );
  exception when unique_violation then
    perform set_config('eavesly.psai245_remaining_finalize', 'off', true);
    return query select 'rejected'::text; return;
  end;
  perform set_config('eavesly.psai245_remaining_finalize', 'off', true);
  update public.eavesly_psai245_remaining56_progress as progress
     set status = 'completed', completed_at = clock_timestamp()
   where progress.call_id = p_call_id and progress.status = 'attempted';
  return query select 'inserted'::text;
end;
$function$;

create or replace function public.eavesly_fail_achieve_backfill_remaining56_v1(
  p_call_id text, p_reason text, p_approved_digest text, p_completed_canary_call_id text
)
returns table(status text)
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare v_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501', message='service role required'; end if;
  if p_reason not in ('grading_unavailable','invalid_response','write_unavailable') then
    raise exception using errcode='22023', message='invalid PSAI-245 remaining-56 failure';
  end if;
  update public.eavesly_psai245_remaining56_progress as progress
     set status='failed', failure_reason=p_reason, completed_at=clock_timestamp()
   where progress.call_id=p_call_id and progress.status='attempted' and progress.approved_digest=p_approved_digest
     and progress.completed_canary_call_id=p_completed_canary_call_id
  returning 'recorded' into v_status;
  if v_status = 'recorded' then return query select v_status; return; end if;
  select case when p.status='failed' then 'already_recorded' else 'rejected' end into v_status
    from public.eavesly_psai245_remaining56_progress p where p.call_id=p_call_id;
  return query select coalesce(v_status, 'rejected');
end;
$function$;

revoke all on function public.eavesly_initialize_achieve_backfill_remaining56_v1(text[],text,text,text,text) from public, anon, authenticated;
revoke all on function public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text) from public, anon, authenticated;
revoke all on function public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text) from public, anon, authenticated;
grant execute on function public.eavesly_initialize_achieve_backfill_remaining56_v1(text[],text,text,text,text) to service_role;
grant execute on function public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text) to service_role;
grant execute on function public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text) to service_role;
grant execute on function public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text) to service_role;

commit;
