# PSAI-245 Achieve historical QA backfill gates

This runbook covers Gate 1 and the separately approved **Gate 2 one-call
canary**. Gate 1 remains read-only. Gate 2 accepts one complete ID-only Gate 1
artifact, authorizes exactly one member call, and may insert exactly one
`audit_only` result. It has no batch or full-cohort execution capability.

## Frozen snapshot lineage

The approved historical snapshot is immutable:

- cutoff: `2026-08-11T16:21:44.777859Z`
- funnel: `378 → 101 → 89 → 88 → 65 → 57`
- reconstruction meaning: 378 feedback rows; 101 with current
  `matched_call_id IS NULL`; 89 nearest valid-phone/time matches within
  `-24h/+1h`; 88 unique calls; 65 with nonblank `original_transcript`; 57 where
  the existing `segmentWelcomeCall(...)` returned `segment_found === true`
- stronger submitter matching was not part of this historical cohort
- module: exact `achieve_welcome_call_qa` only (never GOTA)

The 57 production IDs were deliberately deleted from local artifacts. Do not
reconstruct the cohort through this HTTP interface and do not add transcripts or
other call content to the request. Obtain the separately approved frozen IDs
through the private operator channel and keep the private request and resulting
manifest access-controlled.

## Gate 1 — create manifest and digest

Endpoint:

```text
POST /api/v1/admin/achieve-welcome-call-qa/backfill/dry-run
```

It uses `INTERNAL_API_KEY`, requires `Content-Type: application/json`, and accepts
exactly this shape:

```json
{
  "snapshot_cutoff": "2026-08-11T16:21:44.777859Z",
  "call_ids": ["57 privately supplied call IDs"]
}
```

The placeholder above is documentation, not a valid request. The real
`call_ids` array must contain exactly 57 unique opaque IDs. Unknown fields,
malformed IDs, duplicate IDs, the wrong count, an unknown call, or a different
cutoff fail closed.

Before running, store the request outside the repository with owner-only
permissions. Never add transcript, summary, recording URL, phone, name/email,
lead ID, or other call content/PII. From a trusted operator shell:

```bash
umask 077
jq -e '
  keys == ["call_ids", "snapshot_cutoff"] and
  .snapshot_cutoff == "2026-08-11T16:21:44.777859Z" and
  ((.call_ids | length) == 57 and (.call_ids | unique | length) == 57) and
  all(.call_ids[]; test("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"))
' /private/path/psai-245-request.json >/dev/null

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @/private/path/psai-245-request.json \
  https://eavesly-api.trypennie.dev/api/v1/admin/achieve-welcome-call-qa/backfill/dry-run \
  > /private/path/psai-245-gate-1-response.json
chmod 600 /private/path/psai-245-gate-1-response.json
```

Gate 1 performs only two ID/categorical projections:

1. known `call_id` values from `eavesly_calls`;
2. exact-module result `call_id` plus the nested
   `result_json.backfill.audit_only` value, projected under the categorical
   `audit_only_marker` alias without text coercion.

Only the exact JSON boolean `true` at `result_json.backfill.audit_only` is audit
exempt. Every exact-module row with a missing, null, string (including
`"true"`), false, or other non-true marker is an ordinary result conflict, and
one conflict rejects the entire cohort. Malformed dependency output also fails
closed.
No result row means the candidate is eligible for the approval manifest.

A successful response has `status: ready_for_gate_2_approval`, a sorted manifest,
and a lowercase SHA-256 digest. Save the complete response as the Gate 1 artifact;
it contains IDs and safe categorical/lineage fields only.

### Digest representation

The digest covers **only** `manifest`; it excludes HTTP headers, correlation IDs,
runtime timestamps, and the outer status/digest fields.

- representation: `psai-245-achieve-backfill-manifest-v1`
- canonicalization: `eavesly-canonical-json-v1`
- encoding: UTF-8
- JSON: no insignificant whitespace; object keys sorted lexicographically at
  every level; arrays preserved
- candidates: sorted by `call_id` ascending before canonicalization
- digest: SHA-256 rendered as 64 lowercase hexadecimal characters

Independently verify a saved response without printing IDs:

```bash
python3 - /private/path/psai-245-gate-1-response.json <<'PY'
import hashlib, json, sys

with open(sys.argv[1], encoding="utf-8") as source:
    response = json.load(source)
canonical = json.dumps(
    response["manifest"], sort_keys=True, separators=(",", ":"), ensure_ascii=False
).encode("utf-8")
actual = hashlib.sha256(canonical).hexdigest()
assert response["digest"]["algorithm"] == "SHA-256"
assert response["digest"]["canonicalization"] == "eavesly-canonical-json-v1"
assert actual == response["digest"]["value"]
print("Gate 1 digest verified")
PY
```

Static and public-seam no-write checks from the repository root:

```bash
! grep -En '\.(insert|upsert|update|delete)\(' \
  src/routes/achieve-backfill-admin.ts \
  src/services/achieve-backfill-dry-run.ts \
  src/services/achieve-backfill-inspector.ts
npx vitest run src/routes/achieve-backfill-admin.test.ts \
  src/services/achieve-backfill-inspector.test.ts
```

## Gate 2 — exact-digest one-call canary

Noah separately approved this exact Gate 1 digest for implementation and one
canary only:

```text
01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e
```

The bounded endpoint is:

```text
POST /api/v1/admin/achieve-welcome-call-qa/backfill/canary
```

It uses `INTERNAL_API_KEY`, requires `Content-Type: application/json`, and accepts
only the complete saved Gate 1 artifact plus one member ID:

```json
{
  "manifest": {
    "representation_version": "psai-245-achieve-backfill-manifest-v1",
    "gate": "gate_1_dry_run",
    "module_name": "achieve_welcome_call_qa",
    "snapshot": {
      "cutoff": "2026-08-11T16:21:44.777859Z",
      "funnel_counts": [378, 101, 89, 88, 65, 57]
    },
    "candidate_count": 57,
    "candidates": ["the 57 complete sorted Gate 1 candidate objects"]
  },
  "digest": {
    "algorithm": "SHA-256",
    "canonicalization": "eavesly-canonical-json-v1",
    "value": "01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e"
  },
  "canary_call_id": "exactly one call_id present in manifest.candidates"
}
```

The placeholders are documentation, not valid values. Use the owner-only saved
Gate 1 response to construct the command; do not copy production IDs into the
repository, tickets, chat, shell history, or shared logs. The schema rejects
unknown fields, extra canary IDs, private call content, wrong lineage, wrong
versions, malformed IDs, and wrong candidate count.

Before any read or grading, Gate 2 canonicalizes `manifest` again and requires
both the submitted digest and the recomputed digest to equal the server-owned
approved value above. It also requires sorted unique candidates and membership
of `canary_call_id`. Any change to the 57 IDs or lineage fails authorization.

The HTTP route does not load a transcript or call the LLM. After exact artifact
validation, it creates one dedicated `AchieveBackfillCanaryWorkflow` instance.
Its deterministic ID is the approved digest plus the fixed canary identity, not
the selected member, so concurrent retries and different-member requests for the
same approval can create at most one Workflow. Responses are `queued` or
`already_queued` and never wait on grading. The full ID-only command is parsed
again at the Workflow serialization boundary.

A successful Workflow creation consumes that deterministic instance ID even if
the instance later fails transiently. Repeating the HTTP command then returns
`already_queued`; it does not create a replacement. The private execution step
has automatic retries disabled, so a failed instance must not automatically make
a second LLM attempt. The operator must inspect the existing Workflow instance,
its categorical status, and the database finalization state, then seek explicit
approval before deleting the instance or attempting any retry. Never delete and
recreate the instance as routine incident recovery.

Before loading the selected transcript, the dedicated Workflow performs an
initial recheck of all 57 IDs:

1. every candidate must still exist in `eavesly_calls`;
2. every exact `achieve_welcome_call_qa` row is projected as call ID plus only
   categorical nested backfill provenance;
3. an ordinary result anywhere rejects the whole command; only exact JSON
   `result_json.backfill.audit_only === true` is audit-only;
4. an audit-only row with missing or different digest, batch/canary identity,
   manifest version, cutoff, or canary call ID also rejects the whole command.

An exact existing audit-only row for this approved digest and canary returns
`already_completed` without loading the transcript or invoking the LLM. The
selected transcript is fetched privately from `eavesly_transcription_qa` only
after all checks pass. The production Achieve module runs
`segmentWelcomeCall(...)`; only its bounded live welcome segment reaches the LLM.
Grading is a named durable Workflow step with automatic retries disabled: one
approved Workflow instance can make at most one LLM attempt. The HTTP and
Workflow results never contain the transcript or grading result.

After the LLM returns, the dedicated Workflow calls the service-role-only
`eavesly_finalize_achieve_backfill_canary_v1` RPC. In one short database
transaction, it locks result writers, locks call deletion, final-rechecks all 57
IDs and all exact-module conflicts, and then performs one plain `INSERT`. No
transaction is held across the LLM call. Apply and verify
`docs/sql/psai-245-gate2-canary.sql` before the Worker capability is deployed.
The repository's disposable PostgreSQL 16 check applies the migration and proves
concurrent different-member exclusion, same-member idempotency, final conflict
recheck, and ordinary-upsert immutability:

```bash
npm run test:psai245-gate2-db
```

The migration adds a partial unique index on approved digest/canary identity, so
two concurrent requests selecting different members cannot both persist. It also
adds a trigger with a SQL `WHEN` predicate that rejects every later update or
delete of the exact approved audit canary. Ordinary rows are filtered before the
PL/pgSQL trigger function is invoked; an ordinary `storeModuleResult` upsert
therefore cannot overwrite the canary but unrelated updates/deletes avoid the
function call. Same-member retries return `already_completed`; any
different-member, ordinary-result, different-provenance, or uniqueness race
fails closed. There is no update, upsert, conflict merge, generic
`EvaluationWorkflow`, notification, Slack dispatch, or manager feedback path in
Gate 2. The inserted row always has `alert_sent = false`, `alert_sent_at = null`,
no copied contact/call metadata, and:

```json
{
  "backfill": {
    "audit_only": true,
    "approved_digest": "01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e",
    "batch_id": "psai-245-gate-2-approved-manifest",
    "canary_id": "psai-245-gate-2-one-call-canary",
    "canary_call_id": "the selected member call ID",
    "manifest_version": "psai-245-achieve-backfill-manifest-v1",
    "snapshot_cutoff": "2026-08-11T16:21:44.777859Z"
  }
}
```

### Gate 2 migration rollout and rollback

The partial index in `docs/sql/psai-245-gate2-canary.sql` is intentionally a
normal, non-`CONCURRENTLY` index because the migration is transactional. PostgreSQL
acquires a `SHARE` table lock while building it. Reads continue, but
`INSERT`/`UPDATE`/`DELETE` writers to `eavesly_module_results` wait from index-lock
acquisition through transaction commit. The window is table-size and load
dependent: expect the index scan/build time plus the remaining short DDL, not a
zero-downtime index build.

Before applying the migration, record exact counts and relation sizes without
selecting any call IDs:

```sql
select
  count(*) as module_result_rows,
  count(*) filter (
    where module_name = 'achieve_welcome_call_qa'
      and result_json #> '{backfill,audit_only}' = 'true'::jsonb
      and result_json #>> '{backfill,batch_id}' = 'psai-245-gate-2-approved-manifest'
      and result_json #>> '{backfill,canary_id}' = 'psai-245-gate-2-one-call-canary'
  ) as psai245_index_rows
from public.eavesly_module_results;

select
  pg_size_pretty(pg_relation_size('public.eavesly_module_results')) as heap_size,
  pg_size_pretty(pg_total_relation_size('public.eavesly_module_results')) as total_size;
```

`psai245_index_rows` must be zero before the first canary. Use the exact row count,
size, current write rate, and the environment's prior index-build timing to book
a maintenance window. Coordinate or pause ordinary result writers, monitor lock
waits, and use the approved change runner's bounded lock/statement timeouts so a
busy table aborts rather than producing an unbounded writer queue. Do not apply
at peak traffic or combine this window with canary execution.

Deployment order is strict:

1. Obtain migration/change-window approval and capture the preflight counts and
   sizes above.
2. Apply `docs/sql/psai-245-gate2-canary.sql` and verify the transaction commits,
   the partial index and trigger exist, and only `service_role` can execute the
   finalization RPC.
3. Run the disposable PostgreSQL migration check and approved environment smoke
   checks; do not invoke the canary route.
4. Deploy the Worker with the dedicated
   `ACHIEVE_BACKFILL_CANARY_WORKFLOW` binding and verify configuration/health
   without submitting the artifact.
5. Obtain a separate explicit execution approval, invoke exactly one canary, and
   stop for review.

Routine rollback is permitted only before any canary is queued or persisted.
Stop the Worker deployment first, then run this exact database sequence:

```sql
begin;

drop trigger if exists eavesly_module_results_psai245_canary_immutable
  on public.eavesly_module_results;

drop function if exists public.eavesly_reject_psai245_canary_mutation_v1();

drop function if exists public.eavesly_finalize_achieve_backfill_canary_v1(
  text[], text, jsonb, boolean, text, integer, text, text, text
);

drop index if exists public.eavesly_module_results_psai245_canary_digest_uidx;

commit;
```

The trigger must be dropped before its function; the index is removed only after
the functions. Do **not** use this rollback after a canary has been queued or
persisted without an explicit data-retention/deletion decision and separate
approval. Dropping these protections does not remove a persisted row and would
make the approved identity mutable/reusable.

HTTP responses and logs contain no call IDs: only `queued`, `already_queued`, or
categorical validation/enqueue failure plus canary ordinal, candidate count, and
digest. Workflow results are likewise categorical/count/digest only. Always save
request/response files owner-only and do not use verbose HTTP tracing.

QVV audit-only filtering was already deployed and verified under PSAI-244. Gate 2
does not change QVV.

This implementation is **not authorization to deploy or invoke the endpoint**.
Do not execute the canary until independent review, merge/deployment approval,
and an explicit operator go-ahead. After one canary, stop for result review.
There is intentionally no endpoint for batches greater than one or all 57 calls;
that requires a separately approved implementation and gate.
