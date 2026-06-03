# Deepgram Transcribe-and-Evaluate — Design

**Date:** 2026-05-27
**Status:** Approved (design)
**Linear:** PSAI-159
**Author:** Claude Code (with Noah)

## Problem

Eavesly is transcript-driven: it accepts a pre-transcribed `transcript.transcript`
string and runs LLM QA modules on it. Regal currently supplies that transcript text.
The team is evaluating moving off Regal (not committed yet) and wants eavesly to be
able to produce transcripts itself from a call recording (e.g. a Twilio recording mp3).

This work is **additive and parallel**: the existing Regal path must remain unchanged
so the new Deepgram path can be tested side-by-side in production with zero risk.

## Goals

- Accept a call **recording URL** (Twilio) instead of a transcript, transcribe it, and
  run the existing evaluation pipeline on the result.
- Produce a **speaker-labeled** transcript matching the format the eval prompts expect
  (`[handling agent]`, `[contact]`, `[transfer agent]`), because the QA modules judge
  the agent's behavior specifically and rely on speaker separation.
- Leave the Regal `/evaluate/{module}` path byte-for-byte unchanged.

## Non-goals (YAGNI)

- No Twilio webhook receiver. The caller passes `recording_url` in the request body.
- No transcript caching across modules. One transcription per workflow invocation.
  Calling multiple modules for the same `call_id` re-transcribes; caching by `call_id`
  is noted as a future optimization, not built now.
- Not removing or changing the Regal integration. Regal stays primary.

## Architecture & data flow

The existing pipeline is:

```
POST /api/v1/evaluate/{module}   (transcript in body)
  -> create EvaluationWorkflow
       Step 0: fetch-call-history
       Step 1: evaluate-llm
       Step 2: store-result
       Step 2b: store-qa-result (full_qa only)
       Step 3: dispatch-alerts
       Step 4: log-completion
```

We add a **new endpoint variant** and **one new workflow step at the front**:

```
POST /api/v1/evaluate/{module}/from-recording   (recording_url in body, NO transcript)
  -> create EvaluationWorkflow with a `recording` param
       Step 0: transcribe-recording   <-- NEW, runs only when transcript is absent
                 fetch mp3 from Twilio (Basic Auth)
                 -> Deepgram /v1/listen (diarize + utterances + multichannel)
                 -> format speaker-labeled transcript
                 -> populate callData.transcript
       Step 1..N: (existing steps, UNCHANGED)
```

The Regal path skips Step 0 entirely (transcript already present). Same workflow class,
so all module logic, storage, alerting, and logging are reused.

## New components

### `src/services/twilio-recording.ts`
- `fetchRecording(env, recordingUrl): Promise<ArrayBuffer>`
- Downloads the recording from Twilio with HTTP Basic Auth using
  `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`. Twilio recordings are private.
- Ensures the `.mp3` media representation is requested.
- Throws a clear error on missing creds, 401, or 404.

### `src/services/deepgram-client.ts`
- Factory `createDeepgramClient(env)` mirroring `llm-client.ts` (uses `withRetry`).
- `transcribe(audio: ArrayBuffer): Promise<DeepgramResult>`
- POSTs audio bytes to
  `https://api.deepgram.com/v1/listen?model={DEEPGRAM_MODEL}&diarize=true&utterances=true&punctuate=true&smart_format=true&multichannel=true`
  with header `Authorization: Token <DEEPGRAM_API_KEY>`.
- Uses the **synchronous batch** response (no `callback` param, so no async/202 path,
  no callback infrastructure). Returns utterances + channel info + metadata
  (including duration).
- Logs token/duration analogous to the LLM client's logging.

### `src/services/transcript-formatter.ts`
- `formatTranscript(result: DeepgramResult): { transcript: string; durationSec: number }`
- Converts Deepgram utterances into the bracket-labeled string the prompts expect.

## Speaker -> role mapping

Two-tier, most-reliable first:

1. **Dual-channel (deterministic).** If Twilio recorded dual-channel and Deepgram
   returns 2 channels, map by channel: one leg = `[handling agent]`, the other =
   `[contact]`. Not a guess.
2. **Mono + diarization (heuristic).** First speaker on an outbound call =
   `[handling agent]`, second = `[contact]`; 3rd+ speakers => `[transfer agent]` /
   `[speaker N]`.

The implementation **auto-detects** which case applies from the Deepgram response, so it
is safe whether recordings are mono or dual-channel.

**Safety net:** the eval prompts already re-derive agent/contact roles from speaker
patterns and content, so a mislabel degrades gracefully rather than breaking evaluation.
The heuristic's limitations will be documented in code comments.

## Configuration

New environment values:

| Key | Type | Notes |
|-----|------|-------|
| `DEEPGRAM_API_KEY` | secret | `wrangler secret put` |
| `TWILIO_ACCOUNT_SID` | secret | for Basic Auth fetch |
| `TWILIO_AUTH_TOKEN` | secret | for Basic Auth fetch |
| `DEEPGRAM_MODEL` | var | default `nova-3` |

These are **not** added to the global `REQUIRED_KEYS` in `validate-env.ts`. They are
validated **inside the transcribe step** with a clear error message, so existing
Regal-only deployments keep working until the secrets are configured.

`Bindings` (src/types/env.ts) gains the three optional secrets and the model var.
`wrangler.toml` gets `DEEPGRAM_MODEL` under `[vars]` (+ staging/production) and the new
secrets documented in the secrets comment block.

## Request schema

New `EvaluateFromRecordingRequestSchema` (src/schemas/requests.ts):
- Same shape as `EvaluateRequestSchema` **minus** the `transcript` object, **plus**:
  - `recording_url: string` (required)
  - `recording_source: "twilio"` (default `"twilio"`)
  - `metadata: { timestamp: string; duration?: number; talk_time?; disposition?;
    campaign_name? }` — same fields as `TranscriptMetadataSchema` except `duration`
    is **optional** (filled in from Deepgram's reported duration when absent).
- After transcription, the workflow assembles the standard
  `callData.transcript = { transcript: <formatted text>, metadata: <merged metadata
  with duration> }` so all downstream steps see the exact shape the Regal path produces.

## Workflow changes

`EvaluationParams` (src/workflows/evaluation-workflow.ts) gains an optional
`recording?: { url: string; source: "twilio" }`. Step 0 `transcribe-recording`:
- Runs only when `callData.transcript?.transcript` is empty/absent AND `recording` is set.
- Validates Deepgram/Twilio config; fetches audio; transcribes; formats; writes the
  resulting transcript and duration back into the in-memory `callData` used by later steps.
- Has its own retry policy (`retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }`,
  `timeout: "5 minutes"`) since it makes two network calls.

## Endpoint wiring

`createEvalRoutes` (src/routes/create-eval-routes.ts) is extended so every module route
**also** registers `POST /evaluate/{endpoint}/from-recording`. That handler validates
with `EvaluateFromRecordingRequestSchema`, builds `callData` with a placeholder/empty
transcript, and creates the workflow with the `recording` param. The instance id is
`${call_id}-${moduleName}` (same as today), preserving idempotency.

## Error handling

- Missing `DEEPGRAM_API_KEY` / Twilio creds -> clear config error, step fails.
- Twilio 401/404 -> surfaced with status code in the error.
- Empty/blank Deepgram transcript -> fail the workflow with a logged reason rather than
  running eval on empty text.
- Memory bound: the Worker buffers the mp3 in memory (Deepgram pre-recorded sync API has
  no 25 MB cap — that was the Workers-AI Whisper limit — but Worker memory is ~128 MB).
  Fine for typical call lengths; documented as a known bound. Streaming upload is a future
  optimization if very long recordings appear.

## Testing

- **Unit — twilio-recording:** mocked `fetch`; asserts Basic Auth header and `.mp3` URL;
  error paths (401/404/missing creds).
- **Unit — deepgram-client:** mocked `fetch`; asserts query params + auth header; parses a
  representative response; retry on transient failure.
- **Unit — transcript-formatter:** dual-channel mapping, diarization first-speaker
  heuristic, 3-speaker case, empty result.
- **Workflow:** transcribe step runs when transcript absent + recording present; skipped
  when transcript present (Regal path); config-missing error path.
- **Route:** `/evaluate/{module}/from-recording` validates body and queues a workflow;
  rejects a body missing `recording_url`.

## Open confirmations (resolved)

- Endpoint shape: per-module `/evaluate/{module}/from-recording` (mirrors existing routes). ✔
- Dual vs mono channel: auto-detect and handle both. ✔
