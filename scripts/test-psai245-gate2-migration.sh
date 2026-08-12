#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container="psai245-gate2-postgres-${RANDOM}-${RANDOM}"
tmp_dir=$(mktemp -d)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp_dir"' EXIT

docker run --rm --detach --name "$container" \
  -e POSTGRES_PASSWORD=test-password \
  postgres:16-alpine >/dev/null

ready_checks=0
for _ in $(seq 1 80); do
  if docker exec "$container" psql -X -q -U postgres -d postgres -c "select 1" >/dev/null 2>&1; then
    ready_checks=$((ready_checks + 1))
    if [[ "$ready_checks" -eq 3 ]]; then
      break
    fi
  else
    ready_checks=0
  fi
  sleep 0.25
done
[[ "$ready_checks" -eq 3 ]]

psql_exec() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -q -U postgres -d postgres "$@"
}

psql_exec <<'SQL'
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

create table public.eavesly_calls (
  call_id text primary key
);
create table public.eavesly_module_results (
  call_id text not null,
  module_name text not null,
  result_json jsonb not null,
  has_violation boolean not null,
  violation_type text,
  alert_sent boolean,
  alert_sent_at timestamptz,
  processing_time_ms integer,
  unique (call_id, module_name)
);
insert into public.eavesly_calls(call_id)
select 'approved-call-' || lpad(value::text, 2, '0')
from generate_series(1, 57) as ids(value);
SQL

psql_exec < "$repo_root/docs/sql/psai-245-gate2-canary.sql"

cat > "$tmp_dir/finalize.sql" <<'SQL'
set role service_role;
set request.jwt.claim.role = 'service_role';
select status || ':' || coalesce(reason, '')
from public.eavesly_finalize_achieve_backfill_canary_v1(
  array(select 'approved-call-' || lpad(value::text, 2, '0') from generate_series(1, 57) ids(value)),
  :'canary',
  jsonb_build_object(
    'grading', 'categorical',
    'backfill', jsonb_build_object(
      'audit_only', true,
      'approved_digest', '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e',
      'batch_id', 'psai-245-gate-2-approved-manifest',
      'canary_id', 'psai-245-gate-2-one-call-canary',
      'canary_call_id', :'canary',
      'manifest_version', 'psai-245-achieve-backfill-manifest-v1',
      'snapshot_cutoff', '2026-08-11T16:21:44.777859Z'
    )
  ),
  false,
  null,
  1,
  '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e',
  'psai-245-achieve-backfill-manifest-v1',
  '2026-08-11T16:21:44.777859Z'
);
SQL

# Two different selected members finalize concurrently. The table lock and
# partial unique index must yield one insert and one categorical rejection.
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -Atq -U postgres -d postgres \
  -v canary=approved-call-01 < "$tmp_dir/finalize.sql" > "$tmp_dir/first.out" &
first_pid=$!
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -Atq -U postgres -d postgres \
  -v canary=approved-call-02 < "$tmp_dir/finalize.sql" > "$tmp_dir/second.out" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

sort "$tmp_dir/first.out" "$tmp_dir/second.out" > "$tmp_dir/statuses.out"
grep -Fx 'inserted:' "$tmp_dir/statuses.out" >/dev/null
grep -E '^rejected:(different_audit_provenance|canary_already_used)$' "$tmp_dir/statuses.out" >/dev/null
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json #> '{backfill,audit_only}' = 'true'::jsonb")" = "1"

winner=$(psql_exec -Atc "select call_id from public.eavesly_module_results where result_json #> '{backfill,audit_only}' = 'true'::jsonb")
test "$(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -Atq -U postgres -d postgres -v canary="$winner" < "$tmp_dir/finalize.sql")" = "already_completed:"

# The ordinary upsert path must not overwrite the immutable exact audit result.
if psql_exec -v winner="$winner" >"$tmp_dir/overwrite.out" 2>"$tmp_dir/overwrite.err" <<'SQL'
insert into public.eavesly_module_results (
  call_id, module_name, result_json, has_violation, alert_sent
) values (
  :'winner', 'achieve_welcome_call_qa', '{"ordinary":true}', false, false
)
on conflict (call_id, module_name) do update
  set result_json = excluded.result_json;
SQL
then
  echo "ordinary upsert unexpectedly overwrote the audit canary" >&2
  exit 1
fi
grep -F "PSAI-245 audit canary result is immutable" "$tmp_dir/overwrite.err" >/dev/null
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json #> '{backfill,audit_only}' = 'true'::jsonb")" = "1"

# The SQL WHEN predicate must bypass the exception-only trigger function for
# ordinary rows, allowing normal update/delete traffic while the canary remains.
psql_exec <<'SQL'
insert into public.eavesly_module_results (
  call_id, module_name, result_json, has_violation, alert_sent
) values (
  'ordinary-call', 'achieve_welcome_call_qa', '{"ordinary":true}', false, false
);
update public.eavesly_module_results
   set result_json = '{"ordinary":"updated"}'
 where call_id = 'ordinary-call'
   and module_name = 'achieve_welcome_call_qa';
delete from public.eavesly_module_results
 where call_id = 'ordinary-call'
   and module_name = 'achieve_welcome_call_qa';
SQL
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json #> '{backfill,audit_only}' = 'true'::jsonb")" = "1"
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where call_id = 'ordinary-call'")" = "0"

# A conflict created after the initial Worker check is caught by the atomic final
# 57-ID check and no second audit row is inserted.
psql_exec <<'SQL'
truncate public.eavesly_module_results;
insert into public.eavesly_module_results (
  call_id, module_name, result_json, has_violation, alert_sent
) values (
  'approved-call-57', 'achieve_welcome_call_qa', '{"ordinary":true}', false, false
);
SQL

test "$(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -X -Atq -U postgres -d postgres -v canary=approved-call-01 < "$tmp_dir/finalize.sql")" = "rejected:ordinary_results_exist"
test "$(psql_exec -Atc "select count(*) from public.eavesly_module_results where result_json #> '{backfill,audit_only}' = 'true'::jsonb")" = "0"

# The documented pre-canary rollback order is executable: trigger first, then
# functions, then index. This test has no persisted canary at rollback time.
psql_exec <<'SQL'
begin;
drop trigger if exists eavesly_module_results_psai245_canary_immutable
  on public.eavesly_module_results;
drop function if exists public.eavesly_reject_psai245_canary_mutation_v1();
drop function if exists public.eavesly_finalize_achieve_backfill_canary_v1(
  text[], text, jsonb, boolean, text, integer, text, text, text
);
drop index if exists public.eavesly_module_results_psai245_canary_digest_uidx;
commit;
SQL
test "$(psql_exec -Atc "select count(*) from pg_trigger where tgname = 'eavesly_module_results_psai245_canary_immutable'")" = "0"
test "$(psql_exec -Atc "select to_regprocedure('public.eavesly_reject_psai245_canary_mutation_v1()') is null")" = "t"
test "$(psql_exec -Atc "select to_regprocedure('public.eavesly_finalize_achieve_backfill_canary_v1(text[],text,jsonb,boolean,text,integer,text,text,text)') is null")" = "t"
test "$(psql_exec -Atc "select to_regclass('public.eavesly_module_results_psai245_canary_digest_uidx') is null")" = "t"

echo "PSAI-245 Gate 2 PostgreSQL concurrency, idempotency, final-recheck, exact immutability, ordinary-row trigger bypass, and rollback-order checks passed"
