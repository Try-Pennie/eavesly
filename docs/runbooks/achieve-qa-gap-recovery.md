# Achieve QA — exact transcript-ledger and ordinary gap recovery

These capabilities are separate from the frozen PSAI-245 audit-only backfill. They may restore only the privately reviewed 12-event Snowflake artifact and recover only the privately reviewed 17-call Achieve QA gap artifact. They do not mutate PSAI-245 files, manifests, progress, authorizations, or audit rows; they do not use the generic resolver/evaluation Workflow; and they never dispatch alerts.

No production mutation or execution was performed as part of implementation.

## Stage A: restore the exact 12 transcript events

### Authentication and route

```text
POST /api/v1/admin/achieve-welcome-call-qa/recover-transcript-events
Authorization: Bearer $ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY
Content-Type: application/json
```

This route does not accept `INTERNAL_API_KEY`. Provision a dedicated, random credential of at least 32 characters as the Cloudflare secret `ACHIEVE_QA_TRANSCRIPT_RECOVERY_AUTH_KEY` and the matching Pipedream secret. Missing/short server configuration fails closed with `503`; missing or incorrect credentials return `401`. Authentication uses constant-time digest comparison and runs before body reading, parsing, or database construction.

The route has a route-local 4 MiB byte limit. This admits the reviewed approximately 1.8 MiB source transcript payload plus JSON overhead while bounding memory use. The strict request contains exactly 12 unique canonical `transcript_available` events:

```json
{
  "events": [
    {
      "event_type": "transcript_available",
      "regal_task_id": "<private ID>",
      "transcript": "<private source transcript>",
      "transcript_is_truncated": false,
      "source_event_id": "<private unique Snowflake event ID>"
    }
  ]
}
```

The recovery-only source schema requires a nonblank transcript, explicit `transcript_is_truncated: false`, and a nonblank `source_event_id`; all 12 source-event IDs and Regal task IDs must be unique. Each transcript is capped at 262,144 characters. The schema extends the canonical transcript event shape but does not weaken the ordinary `TranscriptAvailableEventSchema` or `EvaluateRequestSchema` 200,000-character limits.

Dry run is the default. Its response is aggregate-only and `Cache-Control: no-store`:

```json
{
  "status": "dry_run_complete",
  "dry_run": true,
  "candidate_count": 12,
  "ready_insert_count": 12,
  "already_restored_count": 0,
  "digest": {
    "algorithm": "SHA-256",
    "canonicalization": "achieve-qa-transcript-recovery-v1",
    "value": "<private exact-source digest>"
  }
}
```

The digest binds all 12 complete canonical source events in deterministic ID order, but neither events, IDs, transcripts, nor a private manifest are returned or logged.

### Separate approval and execution

After private dry-run review, configure only the approved digest as `ACHIEVE_QA_TRANSCRIPT_RECOVERY_APPROVED_DIGEST`. Execution repeats the exact 12 events and supplies the reviewed digest:

```json
{
  "events": ["<same 12 private canonical events>"],
  "dry_run": false,
  "digest": {
    "algorithm": "SHA-256",
    "canonicalization": "achieve-qa-transcript-recovery-v1",
    "value": "<separately approved digest>"
  }
}
```

The submitted digest and server-owned approval must both match the freshly recomputed source digest. The route performs no resolver-plan creation, Workflow launch, alerting, legacy QA write, or module-result write.

### Insert and state safety

- Reads and writes are bounded to the 12 submitted IDs and persisted `event_type = transcript_available`.
- Persisted rows and payloads are parsed with the strict recovery source schema.
- All 12 absent rows may be inserted in one bulk plain `INSERT`; no upsert is used.
- All 12 canonically identical payloads are an idempotent `already_restored` replay and cause no write.
- Any partial cohort, conflicting payload, malformed row/payload, duplicate row, wrong type, or out-of-cohort response fails closed without filling gaps.
- A unique-key race is re-read and succeeds only if all 12 winners are now identical. Otherwise execution stops categorically.
- Responses and logs contain aggregate counts, categorical reasons, and at most a short digest fingerprint—never IDs, transcripts, event payloads, or customer metadata.

Current production evidence shows all 12 Snowflake events are nonblank and untruncated. Ten source transcripts are at most 200,000 characters; the other two are 205,990 and 206,690 characters, within the recovery-only 262,144 bound.

## Stage B: classify and recover the exact 17 QA gaps

### Route contract

```text
POST /api/v1/admin/achieve-welcome-call-qa/recover-gaps
Authorization: Bearer $INTERNAL_API_KEY
Content-Type: application/json
```

Dry run accepts exactly 17 unique opaque IDs:

```json
{
  "call_ids": ["<17 privately held IDs>"]
}
```

The strict parser rejects unknown fields, malformed/duplicate IDs, and any count other than 17. The aggregate-only response uses `Cache-Control: no-store`. After exact-12 ledger restoration, and only if the reviewed database state is otherwise unchanged, expect 17 transcript-available and zero transcript-unavailable candidates. `processable_count` remains determined by current policy and deterministic production segmentation.

The v2 recovery manifest privately hashes each complete selected source, its source kind, the complete first-pass `WelcomeCallSegment` (including full-source-relative line and confidence metadata), and the bounded `EvaluateRequest`. A source or segmentation change therefore changes the digest:

```json
{
  "algorithm": "SHA-256",
  "canonicalization": "achieve-qa-gap-recovery-v2",
  "value": "<private exact-snapshot digest>"
}
```

A valid newest legacy QA transcript is preferred. A secondary ledger event must still have matching canonical event identity and task ID plus complete, nonblank, untruncated transcript content, and that content must agree exactly with the legacy transcript. Missing or blank recovery-only `source_event_id` provenance is permitted solely for this comparison and does not make the event an eligible fallback source. Disagreement or malformed comparable content fails closed as `invalid_input`. Blank, oversized, ambiguous, or otherwise invalid legacy state does not authorize ledger fallback. Event-only fallback continues to require the strict recovery source schema, including nonblank `source_event_id` provenance.

Canonical ledger sources may be as large as 262,144 characters. The inspector hashes the complete private source, then runs `segmentWelcomeCall` exactly once before constructing an `EvaluateRequest`. The approved first-pass `WelcomeCallSegment` travels through the private in-process grading seam with the bounded input, so the module uses its exact content and full-source-relative metadata without re-identification or a second segmentation pass. Neither the source nor segment is emitted in responses, logs, Workflow commands, or durable step outputs. Only a deterministic segment accepted by the unchanged 200,000-character `EvaluateRequestSchema` can become processable or reach the LLM. The full source is never silently truncated. Unbounded sources remain `segment_unavailable`, and any unexpected grade-time `grading_skipped: true` result is rejected before finalization.

Production evidence shows the two oversized source transcripts produce deterministic transfer-leg segments of approximately 21–23k characters with strong welcome evidence; the dry run must still recompute and privately review their actual classifications.

### Approval, execution, and retry safety

Implementation approval is not execution approval. After private review of one exact v2 dry run, configure that digest as `ACHIEVE_QA_RECOVERY_APPROVED_DIGEST`. Execution must resubmit the same 17 IDs and exact digest. The route and dedicated Workflow recompute the source hashes, segmentation, input hashes, policy, result absence, and complete digest before any grading.

- The dedicated Workflow has `retries.limit = 0`; the one-shot LLM client has `maxRetries = 0` and provider fallback disabled.
- Inputs are processed sequentially and execution stops on the first read, state, grading, or write anomaly.
- Immediately before each grade, the Workflow rechecks exact-module result absence.
- The Workflow and insert adapter both reject `grading_skipped: true`; such a result can never reach persistence.
- Finalization is a plain `INSERT`, never an upsert. SQLSTATE `23505` is classified as `already_exists` without updating the winner.
- Inserted `result_json` is the ordinary module result. No recovery/audit marker is added.
- Inserts force `alert_sent=false`/`alert_sent_at=null` and omit agent, contact, phone, recording, summary, transcript URL, and lead metadata columns.
- No alert extraction/dispatch or generic evaluation metrics run.

Do not execute either stage unless its counts, digest, and categorical state are privately reviewed. Never place transcript text in logs, responses, tickets, shell history, or this runbook; Pipedream must send the private JSON body directly from controlled source data.

## Safe partial-stop re-drive for Stage B

A digest-derived QA Workflow instance is terminal after it stops; do not delete it, invent another ID for the same digest, or restart it. Resolve the categorical failure without changing or deleting completed ordinary results or frozen audit rows, then:

1. Run a fresh Stage B dry run with the same exact 17 private IDs. Completed rows must classify as `existing_result`.
2. Privately compare all aggregates, source/segment classifications, and the new digest with investigated database state.
3. Obtain separate execution approval for the new exact v2 manifest and configure only its digest as `ACHIEVE_QA_RECOVERY_APPROVED_DIGEST`.
4. Submit a new execution command with the same 17 IDs and newly approved digest.

This is a re-drive of remaining reviewed gaps, not a bypass. Never approve a digest merely to route around a terminal instance, delete an old Workflow instance, or skip fresh dry-run review.
