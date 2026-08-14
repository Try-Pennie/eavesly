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
  "transcript_available_count": 15,
  "transcript_unavailable_count": 2,
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

Counts above illustrate the expected storage classification only after the separately controlled first event-ledger backfill; they do not predict a processable count. Current evidence establishes five stored QA transcripts. The twelve remaining Snowflake transcript events are nonblank and untruncated, but their lengths range from 126,836 to 206,690 characters. Ten are within the canonical 200,000-character bound and may be restored by that first bounded backfill, producing 15 transcript-available and two transcript-unavailable candidates if the reviewed storage state is otherwise unchanged. Only stored inputs for which the production `segmentWelcomeCall` returns `segment_found=true` can be processable. A stored but unbounded transcript is `segment_unavailable` and is never inserted as `grading_skipped` merely to clear a gap.

The two events over 200,000 characters are not eligible for that first backfill. Do not weaken `TranscriptAvailableEventSchema` or `EvaluateRequestSchema`, and do not silently truncate them. They require a separate, privately reviewed deterministic segmentation/source-input design before any recovery or persistence is authorized.

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
- The newest nonblank stored QA transcript is selected by `created_at` and, when valid, always takes precedence over the event ledger. The ledger is consulted only when the QA transcript is absent; a blank, oversized, ambiguous, or otherwise invalid QA transcript does not authorize fallback. The repository has no verified stable unique transcript-row field for breaking equal-`created_at` ties, so differing newest rows at the same timestamp fail closed as `invalid_input` rather than choosing nondeterministically.
- Event fallback reads only requested IDs and rows whose persisted `event_type` is exactly `transcript_available`. Both the row and payload are parsed at the boundary, and the canonical payload `regal_task_id` must match the row and requested ID. An out-of-cohort or wrong-type persisted row rejects the inspection as `invalid_response`.
- Event fallback accepts only a nonblank, untruncated transcript of at most 200,000 characters. A malformed canonical payload or a truncated, oversized, mismatched, or duplicate/conflicting event fails closed as `invalid_input`; event transcripts are never truncated or copied into `eavesly_transcription_qa`.
- Immediately before each grade, the Workflow rechecks exact-module result absence.
- Finalization is a plain `INSERT`, never an upsert. Production enforces `UNIQUE(call_id,module_name)`; SQLSTATE `23505` is classified as `already_exists`, preserving the winning ordinary or frozen audit row without update.
- Inserted `result_json` is the ordinary production module result. No `backfill.audit_only` or recovery marker is added.
- Inserts force `alert_sent=false`/`alert_sent_at=null` and omit agent, contact, phone, recording, summary, transcript URL, and lead metadata columns.
- No alert extraction/dispatch or generic evaluation request metrics run.
- Responses, logs, and durable step outputs contain only aggregate counts, categorical reasons, and a short digest fingerprint in logs. They never contain IDs, transcripts, result content, or customer metadata.

## Expected capability and stop rules

A safe dry run should account for all 17 as a categorical partition. Before any event-ledger backfill, current source evidence predicts five QA transcripts and twelve unavailable transcripts. After a separately reviewed first backfill of only the ten canonical events within the 200,000-character bound, and only if the reviewed storage state is otherwise unchanged, expect:

- `transcript_available_count = 15`;
- `transcript_unavailable_count = 2`;
- `invalid_input_count = 0` (an oversized event row appearing in the ledger instead must fail closed here);
- `processable_count <= 15`, determined only by production eligibility and exact segment preflight.

The two oversized source events remain outside this recovery input set until a separate deterministic segmentation/source-input design is reviewed. Stop if they appear as restored ledger rows, if either schema bound has changed, or if any implementation truncates their content.

Do not execute if counts, digest, existing-result state, or expected segment classification are not privately reviewed. Never add transcript text to the request, logs, ticket, shell history, or runbook.

## Safe partial-stop re-drive

A digest-derived Workflow instance is terminal after it stops; do not delete it, invent another ID for the same digest, or try to restart it. First investigate and resolve the categorical failure without changing or deleting any completed ordinary result or frozen audit row. Then:

1. Run a fresh dry run with the same exact 17 private IDs. Rows completed by the prior instance must now classify as `existing_result`; remaining eligible rows may still classify as `processable`.
2. Privately compare all new aggregates and the new digest with the investigated database state. Stop if completed counts, `existing_result_count`, transcript/segment classifications, or any other category are unexpected.
3. Obtain separate execution approval for this newly computed exact manifest and configure only its exact digest as `ACHIEVE_QA_RECOVERY_APPROVED_DIGEST`.
4. Submit a new execution command with the same 17 IDs and newly approved digest. Its new deterministic instance ID is legitimate only because completed rows and therefore the reviewed manifest changed.

This is a re-drive of the remaining reviewed gaps, not a bypass. Never approve an unchanged/new digest merely to route around a terminal instance, never delete an old Workflow instance, and never skip the fresh dry run and private review.
