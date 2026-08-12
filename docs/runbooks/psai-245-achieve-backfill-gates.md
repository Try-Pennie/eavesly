# PSAI-245 Achieve historical QA backfill gates

This runbook covers **Gate 1 only**. Gate 1 is an authenticated, ID-only,
read-only dry run. It does not grade calls, invoke an LLM, launch a Workflow,
send alerts, or insert/update/delete data. No execution endpoint exists in this
change.

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

## Gate 2 — separate approval, no execution in this change

Gate 1 success is **not** approval to execute. Send Noah the saved manifest,
representation/canonicalization versions, and exact digest through the approved
private channel. Gate 2 requires a separate, explicit approval that names that
exact digest. A changed ID, cutoff, manifest version, canonicalization version,
or digest invalidates approval and requires Gate 1 again.

There is intentionally no canary, batching, grading, LLM, write, alert, or
execution capability in PSAI-245 Gate 1. Any future execution must be a separately
reviewed implementation, must verify the explicitly approved digest before it can
act, and must fail closed after rechecking ordinary-result conflicts so a result
created after Gate 1 cannot be overwritten.
