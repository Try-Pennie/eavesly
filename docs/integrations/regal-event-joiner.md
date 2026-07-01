# Regal Event Joiner (shadow mode)

Linear: PSAI-195/196/197/198.

Canonical Regal journey webhook endpoints + a durable ledger, so we can
shadow-compare backend resolver decisions against the current Regal journey
**before** simplifying Regal. These endpoints record events and compute a shadow
plan only — they do **not** run evaluations.

## Endpoints

Both require the standard `Authorization: Bearer <INTERNAL_API_KEY>` header and
accept a custom canonical payload (not the raw Regal event envelope).

- `POST /api/v1/events/transcript-available`
- `POST /api/v1/events/call-completed`

Each returns `202` with:

```json
{
  "regal_task_id": "task-abc",
  "event_type": "transcript_available",
  "status": "recorded",
  "shadow_plan": { "enrolled": true, "triggered": ["full_qa", "disposition_review", "program_expectations", "warm_transfer", "litigation_check"] }
}
```

`shadow_plan` is omitted if the plan could not be computed (best-effort).

> The transcript `task_id` and completed-call `call_id` are the same Regal task
> ID — both normalize to `regal_task_id`.

## Payload examples

### transcript_available

```json
{
  "event_type": "transcript_available",
  "regal_task_id": "task-abc",
  "agent_email": "agent@example.com",
  "contact_name": "Sample Contact",
  "contact_phone": "+10000000000",
  "call_summary": "Short summary of the call.",
  "recording_link": "https://recordings.example.com/task-abc",
  "recording_duration": 1500,
  "transcript": "Full transcript text ...",
  "transcript_url": "https://transcripts.example.com/task-abc",
  "customProperties": { "LegalState": "No", "collectionsBalance": 2 },
  "source_event_id": "regal-evt-1",
  "originalTimestamp": "2026-01-01T00:00:00Z"
}
```

### call_completed

```json
{
  "event_type": "call_completed",
  "regal_task_id": "task-abc",
  "agent_email": "agent@example.com",
  "contact_phone": "+10000000000",
  "disposition": "1.4 - Converted/Won > END CAMPAIGNS",
  "campaign_name": "Sample Campaign",
  "campaign_friendly_id": "camp-1",
  "conversation_happened": true,
  "talk_time": 1200,
  "wrapup_time": 6,
  "handle_time": 1206,
  "recording_duration": 1800,
  "started_at": 1657855046,
  "ended_at": 1657855053,
  "completed_at": 1657855059,
  "source_event_id": "regal-evt-2",
  "originalTimestamp": "2026-01-01T00:20:00Z"
}
```

## Resolver policy (v1)

`joinedEvents + ResolverPolicy -> ModuleTriggerPlan` (see
`src/services/regal-events.ts`). A future QVV admin panel will edit the policy;
decisions read it as data rather than inline conditionals.

| Module | Triggers when |
| --- | --- |
| `full_qa` | transcript event present |
| `disposition_review` | completed event present (or completion timeout) |
| `program_expectations` | **enrolled** |
| `warm_transfer` | enrolled **and** `customProperties.LegalState == "No"` |
| `litigation_check` | enrolled **and** `customProperties.collectionsBalance > 1` |

**Enrolled** = `disposition == "1.4 - Converted/Won > END CAMPAIGNS"` **and**
`recording_duration > 1200` **and** `campaign_friendly_id` not excluded (no exclusions in v1).

## Storage

Two tables (see `docs/sql/regal-event-joiner.sql`, applied manually — no
migration framework here):

- `eavesly_regal_call_events` — durable ledger, idempotent on
  `(regal_task_id, event_type)`.
- `eavesly_regal_resolver_plans` — shadow plans, one per `regal_task_id`.

## Migration note

The current Regal journey continues to own real evaluation unchanged. Once shadow
plans validate against actual journey behavior, we simplify Regal to emit these
canonical events and let the backend resolver drive module triggering.
