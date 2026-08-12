#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container="psai245-resume27-postgres-${RANDOM}-${RANDOM}"
tmp_dir=$(mktemp -d)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp_dir"' EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test-password postgres:16-alpine >/dev/null
ready_checks=0
for _ in $(seq 1 80); do
  if docker exec "$container" psql -X -q -U postgres -d postgres -c "select 1" >/dev/null 2>&1; then
    ready_checks=$((ready_checks + 1))
    [[ "$ready_checks" -eq 3 ]] && break
  else
    ready_checks=0
  fi
  sleep .25
done
[[ "$ready_checks" -eq 3 ]]
psql_exec() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -q -U postgres -d postgres "$@"; }

psql_exec <<'SQL'
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.eavesly_calls (call_id text primary key);
create table public.eavesly_module_results (
 call_id text not null, module_name text not null, result_json jsonb not null,
 has_violation boolean not null, violation_type text, alert_sent boolean,
 alert_sent_at timestamptz, processing_time_ms integer,
 agent_email text, contact_name text, contact_phone text, recording_link text,
 call_summary text, transcript_url text, sfdc_lead_id text,
 unique(call_id,module_name)
);
insert into public.eavesly_calls select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i;
SQL

synthetic_digest=298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8
production_digest=01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e
sed "s/$production_digest/$synthetic_digest/g" "$repo_root/docs/sql/psai-245-gate2-canary.sql" > "$tmp_dir/gate2.sql"
sed "s/$production_digest/$synthetic_digest/g" "$repo_root/docs/sql/psai-245-gate3-remaining56.sql" > "$tmp_dir/gate3.sql"
sed "s/$production_digest/$synthetic_digest/g" "$repo_root/docs/sql/psai-245-gate3-resume27.sql" > "$tmp_dir/resume27.sql"
psql_exec < "$tmp_dir/gate2.sql"
psql_exec < "$tmp_dir/gate3.sql"

# The Gate 3 guard trigger function is not directly executable by any API role.
for role in anon authenticated service_role; do
  test "$(psql_exec -Atc "select has_function_privilege('$role','public.eavesly_reject_psai245_remaining56_result_mutation_v1()','EXECUTE')")" = f
done

# Build the exact observed production-state fixture only through Gate 2/Gate 3 public RPCs:
# canary ordinal 1, 28 completed ordinals 2..29, terminal failed ordinal 30, pending 31..57.
psql_exec <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select * from public.eavesly_finalize_achieve_backfill_canary_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01',
 '{"grading":"categorical","backfill":{"audit_only":true,"approved_digest":"298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8","batch_id":"psai-245-gate-2-approved-manifest","canary_id":"psai-245-gate-2-one-call-canary","canary_call_id":"approved-call-01","manifest_version":"psai-245-achieve-backfill-manifest-v1","snapshot_cutoff":"2026-08-11T16:21:44.777859Z"}}',
 false,null,1,'298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z');
select status from public.eavesly_initialize_achieve_backfill_remaining56_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z');
do $$
declare i integer; v_call_id text;
begin
  for i in 2..29 loop
    v_call_id := 'approved-call-' || lpad(i::text,2,'0');
    perform status from public.eavesly_claim_achieve_backfill_remaining56_v1(
      v_call_id,'298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
    perform status from public.eavesly_finalize_achieve_backfill_remaining56_v1(
      v_call_id,
      jsonb_build_object('grading','categorical','backfill',jsonb_build_object(
        'audit_only',true,
        'approved_digest','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
        'batch_id','psai-245-gate-3-approved-remaining-56',
        'capability_id','psai-245-gate-3-remaining-56-once',
        'completed_canary_call_id','approved-call-01',
        'manifest_version','psai-245-achieve-backfill-manifest-v1',
        'snapshot_cutoff','2026-08-11T16:21:44.777859Z')),
      false,null,1,'298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
  end loop;
end $$;
select status from public.eavesly_claim_achieve_backfill_remaining56_v1(
 'approved-call-30','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
select status from public.eavesly_fail_achieve_backfill_remaining56_v1(
 'approved-call-30','grading_unavailable','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
SQL

fixture_counts=$(psql_exec -Atc "select string_agg(status||'='||n,',' order by status) from (select status,count(*) n from public.eavesly_psai245_remaining56_progress group by status) s")
test "$fixture_counts" = "completed=28,failed=1,pending=27"
test "$(psql_exec -Atc "select status||':'||failure_reason from public.eavesly_psai245_remaining56_progress where manifest_ordinal=30")" = "failed:grading_unavailable"
test "$(psql_exec -Atc "select count(*) from public.eavesly_psai245_remaining56_progress where status='attempted'")" = 0
terminal_before=$(psql_exec -Atc "select md5(string_agg(row_to_json(p)::text,',' order by manifest_ordinal)) from public.eavesly_psai245_remaining56_progress p where manifest_ordinal<=30")
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text)','EXECUTE')")" = t
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text)','EXECUTE')")" = t
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text)','EXECUTE')")" = t
trigger_signature_before=$(psql_exec -Atc "
select t.tgname||':'||t.tgenabled::text||':'||function_namespace.nspname||'.'||function_definition.proname||':'||pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class guarded_table on guarded_table.oid=t.tgrelid
join pg_namespace table_namespace on table_namespace.oid=guarded_table.relnamespace
join pg_proc function_definition on function_definition.oid=t.tgfoid
join pg_namespace function_namespace on function_namespace.oid=function_definition.pronamespace
where table_namespace.nspname='public' and guarded_table.relname='eavesly_module_results'
  and t.tgname='eavesly_module_results_psai245_remaining56_guard'")
test -n "$trigger_signature_before"

psql_exec < "$tmp_dir/resume27.sql"
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text)','EXECUTE')")" = f
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_claim_achieve_backfill_resume27_v1(text,text,text,text)','EXECUTE')")" = t
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text)','EXECUTE')")" = t
test "$(psql_exec -Atc "select has_function_privilege('service_role','public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text)','EXECUTE')")" = t
trigger_signature_after=$(psql_exec -Atc "
select t.tgname||':'||t.tgenabled::text||':'||function_namespace.nspname||'.'||function_definition.proname||':'||pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class guarded_table on guarded_table.oid=t.tgrelid
join pg_namespace table_namespace on table_namespace.oid=guarded_table.relnamespace
join pg_proc function_definition on function_definition.oid=t.tgfoid
join pg_namespace function_namespace on function_namespace.oid=function_definition.pronamespace
where table_namespace.nspname='public' and guarded_table.relname='eavesly_module_results'
  and t.tgname='eavesly_module_results_psai245_remaining56_guard'")
test "$trigger_signature_before" = "$trigger_signature_after"

cat > "$tmp_dir/initialize.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
SQL

# The initializer rejects missing canary provenance and missing or disabled Gate 3 guards.
missing_canary=$(psql_exec -Atq <<'SQL'
begin;
alter table public.eavesly_module_results disable trigger eavesly_module_results_psai245_canary_immutable;
delete from public.eavesly_module_results where call_id='approved-call-01' and module_name='achieve_welcome_call_qa';
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$missing_canary" = state_drift

canary_provenance_drift=$(psql_exec -Atq <<'SQL'
begin;
alter table public.eavesly_module_results disable trigger eavesly_module_results_psai245_canary_immutable;
update public.eavesly_module_results
   set result_json=jsonb_set(result_json,'{backfill,batch_id}','"unexpected-batch"'::jsonb)
 where call_id='approved-call-01' and module_name='achieve_welcome_call_qa';
alter table public.eavesly_module_results enable trigger eavesly_module_results_psai245_canary_immutable;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$canary_provenance_drift" = state_drift

missing_guard=$(psql_exec -Atq <<'SQL'
begin;
drop trigger eavesly_module_results_psai245_remaining56_guard on public.eavesly_module_results;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$missing_guard" = state_drift

disabled_guard=$(psql_exec -Atq <<'SQL'
begin;
alter table public.eavesly_module_results disable trigger eavesly_module_results_psai245_remaining56_guard;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$disabled_guard" = state_drift

# Certification rejects missing completed audit rows and no-alert/no-metadata drift.
missing_completed_result=$(psql_exec -Atq <<'SQL'
begin;
alter table public.eavesly_module_results disable trigger eavesly_module_results_psai245_remaining56_guard;
delete from public.eavesly_module_results where call_id='approved-call-02' and module_name='achieve_welcome_call_qa';
alter table public.eavesly_module_results enable trigger eavesly_module_results_psai245_remaining56_guard;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$missing_completed_result" = state_drift

metadata_drift=$(psql_exec -Atq <<'SQL'
begin;
alter table public.eavesly_module_results disable trigger eavesly_module_results_psai245_remaining56_guard;
update public.eavesly_module_results set alert_sent=true, agent_email='unexpected@example.com'
 where call_id='approved-call-02' and module_name='achieve_welcome_call_qa';
alter table public.eavesly_module_results enable trigger eavesly_module_results_psai245_remaining56_guard;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$metadata_drift" = state_drift

extra_gate3_result=$(psql_exec -Atq <<'SQL'
begin;
insert into public.eavesly_module_results(
 call_id,module_name,result_json,has_violation,violation_type,alert_sent,alert_sent_at,processing_time_ms,
 agent_email,contact_name,contact_phone,recording_link,call_summary,transcript_url,sfdc_lead_id
) values (
 'outside-cohort','achieve_welcome_call_qa',
 '{"grading":"categorical","backfill":{"audit_only":true,"approved_digest":"298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8","batch_id":"psai-245-gate-3-approved-remaining-56","capability_id":"psai-245-gate-3-remaining-56-once","completed_canary_call_id":"approved-call-01","manifest_version":"psai-245-achieve-backfill-manifest-v1","snapshot_cutoff":"2026-08-11T16:21:44.777859Z"}}',
 false,null,false,null,1,null,null,null,null,null,null,null
);
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$extra_gate3_result" = state_drift

# State drift is database-derived, not trusted from the supplied fingerprint. The fixture
# injection is a transaction-local owner write because the superseded claim RPC is disabled.
drift_output=$(psql_exec -Atq <<'SQL'
begin;
update public.eavesly_psai245_remaining56_progress
   set status='attempted', attempted_at=clock_timestamp()
 where call_id='approved-call-31' and status='pending';
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_resume27_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$drift_output" = state_drift
test "$(psql_exec -Atc "select status from public.eavesly_psai245_remaining56_progress where manifest_ordinal=31")" = pending

# Concurrent initialization is idempotent and creates one immutable authorization row.
docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/initialize.sql" > "$tmp_dir/init1" & a=$!
docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/initialize.sql" > "$tmp_dir/init2" & b=$!
wait "$a"; wait "$b"
test "$(cat "$tmp_dir/init1")" = ready
test "$(cat "$tmp_dir/init2")" = ready
test "$(psql_exec -Atc "select count(*) from public.eavesly_psai245_resume27_authorization")" = 1

cat > "$tmp_dir/claim.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_claim_achieve_backfill_resume27_v1(
 :'call_id','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01',
 'ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
SQL
cat > "$tmp_dir/finalize.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_finalize_achieve_backfill_remaining56_v1(
 :'call_id',jsonb_build_object('grading','categorical','backfill',jsonb_build_object(
 'audit_only',true,'approved_digest','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'batch_id','psai-245-gate-3-approved-remaining-56','capability_id','psai-245-gate-3-remaining-56-once',
 'completed_canary_call_id','approved-call-01','manifest_version','psai-245-achieve-backfill-manifest-v1',
 'snapshot_cutoff','2026-08-11T16:21:44.777859Z')),false,null,1,
 '298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
SQL

# No resume interface exists for ordinal 30, completed ordinals, canary, or outside cohort.
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-30 < "$tmp_dir/claim.sql")" = rejected
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-29 < "$tmp_dir/claim.sql")" = rejected
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-01 < "$tmp_dir/claim.sql")" = rejected
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=outside-manifest < "$tmp_dir/claim.sql")" = rejected

# An attempted lowest unfinished ordinal blocks every later claim.
attempted_block=$(psql_exec -Atq <<'SQL'
begin;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_claim_achieve_backfill_resume27_v1(
 'approved-call-31','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01','ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
select status from public.eavesly_claim_achieve_backfill_resume27_v1(
 'approved-call-32','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01','ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$attempted_block" = $'claimed\nrejected'

# A failed lowest unfinished ordinal also blocks every later claim.
failed_block=$(psql_exec -Atq <<'SQL'
begin;
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_claim_achieve_backfill_resume27_v1(
 'approved-call-31','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01','ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
select status from public.eavesly_fail_achieve_backfill_remaining56_v1(
 'approved-call-31','grading_unavailable','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
select status from public.eavesly_claim_achieve_backfill_resume27_v1(
 'approved-call-32','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01','ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4');
rollback;
SQL
)
test "$failed_block" = $'claimed\nrecorded\nrejected'

# Concurrent claim(31) versus claim(57) serializes on the lowest unfinished row: only 31 wins.
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-31 < "$tmp_dir/claim.sql" > "$tmp_dir/claim31" & a=$!
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-57 < "$tmp_dir/claim.sql" > "$tmp_dir/claim57" & b=$!
wait "$a"; wait "$b"
test "$(cat "$tmp_dir/claim31")" = claimed
test "$(cat "$tmp_dir/claim57")" = rejected
test "$(psql_exec -Atc "select status from public.eavesly_psai245_remaining56_progress where manifest_ordinal=31")" = attempted
test "$(psql_exec -Atc "select status from public.eavesly_psai245_remaining56_progress where manifest_ordinal=57")" = pending
# Initialization replay remains ready after authorized forward progress; it never resets progress.
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/initialize.sql")" = ready

# Wrong fingerprint never claims, even after authorization.
wrong=$(sed 's/ce2f6acc1fe56eea76c82a0fe8c9a64c8ffe980e7914c0b926f8552b70651ae4/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/' "$tmp_dir/claim.sql" | docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-32)
test "$wrong" = rejected

# Complete the authorized sequence through the unchanged Gate 3 finalizer.
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-31 < "$tmp_dir/finalize.sql")" = inserted
for ordinal in $(seq 32 57); do
  call_id="approved-call-${ordinal}"
  test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id="$call_id" < "$tmp_dir/claim.sql")" = claimed
  test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id="$call_id" < "$tmp_dir/finalize.sql")" = inserted
done

# Final certification target: 55 completed, ordinal 30 as the only failure, and exactly
# 55 corresponding immutable Gate 3 audit rows with no alerts or customer metadata.
final_counts=$(psql_exec -Atc "select string_agg(status||'='||n,',' order by status) from (select status,count(*) n from public.eavesly_psai245_remaining56_progress group by status) s")
test "$final_counts" = "completed=55,failed=1"
test "$(psql_exec -Atc "select status||':'||failure_reason from public.eavesly_psai245_remaining56_progress where manifest_ordinal=30")" = "failed:grading_unavailable"
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json#>>'{backfill,capability_id}'='psai-245-gate-3-remaining-56-once'")" = 55
test "$(psql_exec -Atc "
select count(*) from public.eavesly_psai245_remaining56_progress p
join public.eavesly_module_results r on r.call_id=p.call_id and r.module_name='achieve_welcome_call_qa'
where p.status='completed'
  and r.result_json#>'{backfill,audit_only}'='true'::jsonb
  and r.result_json#>>'{backfill,approved_digest}'='298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8'
  and r.result_json#>>'{backfill,batch_id}'='psai-245-gate-3-approved-remaining-56'
  and r.result_json#>>'{backfill,capability_id}'='psai-245-gate-3-remaining-56-once'
  and r.result_json#>>'{backfill,completed_canary_call_id}'='approved-call-01'
  and r.result_json#>>'{backfill,manifest_version}'='psai-245-achieve-backfill-manifest-v1'
  and r.result_json#>>'{backfill,snapshot_cutoff}'='2026-08-11T16:21:44.777859Z'
  and r.alert_sent=false and r.alert_sent_at is null and r.processing_time_ms>=0
  and r.agent_email is null and r.contact_name is null and r.contact_phone is null
  and r.recording_link is null and r.call_summary is null and r.transcript_url is null and r.sfdc_lead_id is null")" = 55
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results r where r.call_id='approved-call-01' and r.module_name='achieve_welcome_call_qa' and r.result_json#>>'{backfill,canary_id}'='psai-245-gate-2-one-call-canary' and r.result_json#>>'{backfill,approved_digest}'='298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8' and r.alert_sent=false and r.alert_sent_at is null and r.agent_email is null and r.contact_name is null and r.contact_phone is null and r.recording_link is null and r.call_summary is null and r.transcript_url is null and r.sfdc_lead_id is null")" = 1
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where module_name='achieve_welcome_call_qa'")" = 56

# Original terminal/completed progress rows and the semantic Gate 3 trigger identity are unchanged.
terminal_after=$(psql_exec -Atc "select md5(string_agg(row_to_json(p)::text,',' order by manifest_ordinal)) from public.eavesly_psai245_remaining56_progress p where manifest_ordinal<=30")
test "$terminal_before" = "$terminal_after"
test "$trigger_signature_before" = "$(psql_exec -Atc "
select t.tgname||':'||t.tgenabled::text||':'||function_namespace.nspname||'.'||function_definition.proname||':'||pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class guarded_table on guarded_table.oid=t.tgrelid
join pg_namespace table_namespace on table_namespace.oid=guarded_table.relnamespace
join pg_proc function_definition on function_definition.oid=t.tgfoid
join pg_namespace function_namespace on function_namespace.oid=function_definition.pronamespace
where table_namespace.nspname='public' and guarded_table.relname='eavesly_module_results'
  and t.tgname='eavesly_module_results_psai245_remaining56_guard'")"

echo "PSAI-245 resume-27 PostgreSQL exact canary/trigger certification, result invariants, strict sequential concurrency, attempted/failed blocking, final 55/1/55 state, revoke hardening, and terminal-row immutability checks passed"
