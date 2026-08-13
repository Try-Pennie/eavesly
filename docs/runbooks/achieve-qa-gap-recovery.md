# Achieve QA Gate 4 — ordinary gap recovery

This capability is separate from the frozen PSAI-245 audit-only backfill. It may recover only the privately reviewed 17-call Achieve QA gap artifact. It does not mutate PSAI-245 manifests, progress, authorizations, or audit rows; it does not use the generic evaluation Workflow; and it never dispatches alerts.

No production execution was performed as part of implementation.

## Route contract

```text
POST /api/v1/admin/achieve-welcome-call-qa/recover-gaps
Authorization: Bearer $INTERNAL_API_KEY
Content-Type: application/json
```

Dry run (the default) accepts exactly 17 unique opaque IDs:

```json
{
  "call_ids": ["<17 privately held IDs>"]
}
```

The strict parser rejects unknown fields, malformed/duplicate IDs, and any count other than 17. The response is aggregate-only and `Cache-Control: no-store`:

```json
{
  "status": "dry_run_complete",
  "dry_run": true,
  "candidate_count": 17,
  "transcript_available_count": 5,
  "transcript_unavailable_count": 12,
  "processable_count": 0,
  "segment_unavailable_count": 0,
  "invalid_input_count": 0,
  "unknown_call_count": 0,
  "ineligible_count": 0,
  "existing_result_count": 0,
  "digest": {
    "algorithm": "SHA-256",
    "canonicalization": "achieve-qa-gap-recovery-v1",
    "value": "<private exact-snapshot digest>"
  }
}
```

Counts above illustrate fields, not a predicted processable count. Current evidence establishes five stored QA transcripts and twelve `transcript_unavailable` calls. Only stored inputs for which the production `segmentWelcomeCall` returns `segment_found=true` can be processable. A stored but unbounded transcript is `segment_unavailable` and is never inserted as `grading_skipped` merely to clear a gap.

The digest binds sorted IDs, every categorical status, and the SHA-256 of each complete processable `EvaluateRequest`. Changing an ID, transcript, metadata, eligibility, segmentation, or existing-result state changes the digest.

## Separate approval and execution

Implementation approval is not execution approval. After private review of one exact dry run, separately configure that exact digest as the server-owned `ACHIEVE_QA_RECOVERY_APPROVED_DIGEST`. Without it, execution fails closed with `server_approval_missing`.

Execution must resubmit the same 17 IDs and exact dry-run digest:

```json
{
  "call_ids": ["<same 17 privately held IDs>"],
  "dry_run": false,
  "digest": {
    "algorithm": "SHA-256",
    "canonicalization": "achieve-qa-gap-recovery-v1",
    "value": "<separately approved digest>"
  }
}
```

The route recomputes the full private snapshot and requires both the submitted digest and server-owned allowlist to match before creating one deterministic `ACHIEVE_QA_RECOVERY_WORKFLOW` instance. The Workflow repeats the full parse, server approval, inspection, eligibility, segmentation, input-digest, and result-absence checks.

## Write and retry safety

- The dedicated Workflow has `retries.limit = 0` and uses the one-shot OpenAI client (`maxRetries = 0`, provider fallback disabled).
- Inputs are processed sequentially and execution stops on the first read, state, grading, or write anomaly.
- Immediately before each grade, the Workflow rechecks exact-module result absence.
- Finalization is a plain `INSERT`, never an upsert. Production enforces `UNIQUE(call_id,module_name)`; SQLSTATE `23505` is classified as `already_exists`, preserving the winning ordinary or frozen audit row without update.
- Inserted `result_json` is the ordinary production module result. No `backfill.audit_only` or recovery marker is added.
- Inserts force `alert_sent=false`/`alert_sent_at=null` and omit agent, contact, phone, recording, summary, transcript URL, and lead metadata columns.
- No alert extraction/dispatch or generic evaluation request metrics run.
- Responses, logs, and durable step outputs contain only aggregate counts, categorical reasons, and a short digest fingerprint in logs. They never contain IDs, transcripts, result content, or customer metadata.

## Expected capability and stop rules

A safe dry run should account for all 17 as a categorical partition. Current source evidence predicts:

- `transcript_available_count = 5`;
- `transcript_unavailable_count = 12` (clearly unprocessable by this capability);
- `processable_count <= 5`, determined only by the production eligibility and exact segment preflight.

Do not execute if counts, digest, existing-result state, or expected segment classification are not privately reviewed. Never add transcript text to the request, logs, ticket, shell history, or runbook. Never set a new approved digest to bypass a stopped or partially completed instance. A retry resolves to the same digest-derived Workflow ID.
