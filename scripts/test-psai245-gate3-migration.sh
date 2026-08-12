#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container="psai245-gate3-postgres-${RANDOM}-${RANDOM}"
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
# Use a synthetic manifest/digest pair so the exact production IDs stay private;
# only the pinned digest literal is substituted in otherwise-real migrations.
sed 's/01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e/298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8/g' \
  "$repo_root/docs/sql/psai-245-gate2-canary.sql" > "$tmp_dir/gate2.sql"
sed 's/01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e/298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8/g' \
  "$repo_root/docs/sql/psai-245-gate3-remaining56.sql" > "$tmp_dir/gate3.sql"
psql_exec < "$tmp_dir/gate2.sql"
psql_exec < "$tmp_dir/gate3.sql"

# The documented rollback is executable only while progress is empty.
psql_exec <<'SQL'
begin;
do $$ begin
  if exists (select 1 from public.eavesly_psai245_remaining56_progress) then
    raise exception 'Gate 3 progress exists; rollback forbidden';
  end if;
end $$;
drop trigger if exists eavesly_module_results_psai245_remaining56_guard on public.eavesly_module_results;
drop function if exists public.eavesly_reject_psai245_remaining56_result_mutation_v1();
drop function if exists public.eavesly_initialize_achieve_backfill_remaining56_v1(text[],text,text,text,text);
drop function if exists public.eavesly_claim_achieve_backfill_remaining56_v1(text,text,text);
drop function if exists public.eavesly_finalize_achieve_backfill_remaining56_v1(text,jsonb,boolean,text,integer,text,text);
drop function if exists public.eavesly_fail_achieve_backfill_remaining56_v1(text,text,text,text);
drop table if exists public.eavesly_psai245_remaining56_progress;
commit;
SQL
test "$(psql_exec -Atc "select to_regclass('public.eavesly_psai245_remaining56_progress') is null")" = t
psql_exec < "$tmp_dir/gate3.sql"

cat > "$tmp_dir/context.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_remaining56_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z');
SQL
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/context.sql")" = "completed_canary_missing"
cat > "$tmp_dir/tampered-context.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_initialize_achieve_backfill_remaining56_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,56) i union all select 'approved-call-58'),
 'approved-call-01','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z');
SQL
if docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -Atq -U postgres -d postgres \
  < "$tmp_dir/tampered-context.sql" > /dev/null 2> "$tmp_dir/tampered.err"; then
  echo "tampered manifest unexpectedly passed the database digest check" >&2
  exit 1
fi
grep -F 'manifest digest mismatch' "$tmp_dir/tampered.err" >/dev/null

# Seed the one successful Gate 2 canary through its production RPC.
psql_exec <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select * from public.eavesly_finalize_achieve_backfill_canary_v1(
 array(select 'approved-call-'||lpad(i::text,2,'0') from generate_series(1,57) i),
 'approved-call-01',
 '{"grading":"categorical","backfill":{"audit_only":true,"approved_digest":"298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8","batch_id":"psai-245-gate-2-approved-manifest","canary_id":"psai-245-gate-2-one-call-canary","canary_call_id":"approved-call-01","manifest_version":"psai-245-achieve-backfill-manifest-v1","snapshot_cutoff":"2026-08-11T16:21:44.777859Z"}}',
 false,null,1,'298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8',
 'psai-245-achieve-backfill-manifest-v1','2026-08-11T16:21:44.777859Z');
SQL

test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/context.sql")" = "ready"
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres < "$tmp_dir/context.sql")" = "ready"
test "$(psql_exec -Atc "select count(*) from public.eavesly_psai245_remaining56_progress")" = 56
test "$(psql_exec -Atc "select count(*) from public.eavesly_psai245_remaining56_progress where call_id='approved-call-01'")" = 0

cat > "$tmp_dir/claim.sql" <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_claim_achieve_backfill_remaining56_v1(
 :'call_id','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
SQL
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-02 < "$tmp_dir/claim.sql" > "$tmp_dir/claim1" & a=$!
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-02 < "$tmp_dir/claim.sql" > "$tmp_dir/claim2" & b=$!
wait "$a"; wait "$b"
sort "$tmp_dir/claim1" "$tmp_dir/claim2" | grep -Fx $'attempted\nclaimed' >/dev/null
# Canary and outside-manifest claims are impossible.
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-01 < "$tmp_dir/claim.sql")" = rejected
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=outside-manifest < "$tmp_dir/claim.sql")" = rejected

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
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-02 < "$tmp_dir/finalize.sql" > "$tmp_dir/finalize1" & a=$!
docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-02 < "$tmp_dir/finalize.sql" > "$tmp_dir/finalize2" & b=$!
wait "$a"; wait "$b"
sort "$tmp_dir/finalize1" "$tmp_dir/finalize2" | grep -Fx $'already_completed\ninserted' >/dev/null
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json#>>'{backfill,capability_id}'='psai-245-gate-3-remaining-56-once'")" = 1

# Reserved calls reject the ordinary upsert path; completed rows reject update/delete.
if psql_exec <<'SQL' >/dev/null 2>"$tmp_dir/reserved.err"
insert into public.eavesly_module_results(call_id,module_name,result_json,has_violation,alert_sent)
values('approved-call-03','achieve_welcome_call_qa','{"ordinary":true}',false,false);
SQL
then cat "$tmp_dir/reserved.err" >&2; exit 1; fi
grep -F 'reserved for audit-only finalization' "$tmp_dir/reserved.err" >/dev/null

# Reservation is module-scoped: unrelated module traffic on the same call bypasses it.
psql_exec <<'SQL'
insert into public.eavesly_module_results(call_id,module_name,result_json,has_violation,alert_sent)
values('approved-call-04','unrelated_module','{"ordinary":true}',false,false);
update public.eavesly_module_results set result_json='{"ordinary":"updated"}'
 where call_id='approved-call-04' and module_name='unrelated_module';
delete from public.eavesly_module_results
 where call_id='approved-call-04' and module_name='unrelated_module';
SQL

# Even an exactly shaped Gate 3 row cannot bypass the guard outside the finalizer.
if psql_exec <<'SQL' >/dev/null 2>"$tmp_dir/direct-shaped.err"
insert into public.eavesly_module_results(
 call_id,module_name,result_json,has_violation,violation_type,alert_sent,alert_sent_at,
 processing_time_ms,agent_email,contact_name,contact_phone,recording_link,call_summary,transcript_url,sfdc_lead_id
) values (
 'approved-call-04','achieve_welcome_call_qa',
 '{"grading":"categorical","backfill":{"audit_only":true,"approved_digest":"298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8","batch_id":"psai-245-gate-3-approved-remaining-56","capability_id":"psai-245-gate-3-remaining-56-once","completed_canary_call_id":"approved-call-01","manifest_version":"psai-245-achieve-backfill-manifest-v1","snapshot_cutoff":"2026-08-11T16:21:44.777859Z"}}',
 false,null,false,null,1,null,null,null,null,null,null,null
);
SQL
then cat "$tmp_dir/direct-shaped.err" >&2; exit 1; fi
grep -F 'reserved for audit-only finalization' "$tmp_dir/direct-shaped.err" >/dev/null

if psql_exec -c "delete from public.eavesly_module_results where call_id='approved-call-02'" >/dev/null 2>"$tmp_dir/immutable.err"; then exit 1; fi
grep -F 'remaining-56 audit result is immutable' "$tmp_dir/immutable.err" >/dev/null

# A failed attempt is terminal and remains observable without another claim.
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-03 < "$tmp_dir/claim.sql")" = claimed
test "$(psql_exec -Atq <<'SQL'
set role service_role; set request.jwt.claim.role='service_role';
select status from public.eavesly_fail_achieve_backfill_remaining56_v1('approved-call-03','grading_unavailable','298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8','approved-call-01');
SQL
)" = recorded
test "$(psql_exec -Atc "select status||':'||failure_reason from public.eavesly_psai245_remaining56_progress where call_id='approved-call-03'")" = failed:grading_unavailable
test "$(docker exec -i "$container" psql -X -Atq -U postgres -d postgres -v call_id=approved-call-03 < "$tmp_dir/claim.sql")" = failed

echo "PSAI-245 Gate 3 PostgreSQL exact-canary, 56-row initialization, concurrent claim/finalize, at-most-one insert, immutability, unrelated-module bypass, direct-shaped insert rejection, reservation, and terminal-failure checks passed"
