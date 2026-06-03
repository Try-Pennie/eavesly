# Eavesly

AI-powered Call QA system that evaluates customer service calls using structured LLM analysis. Built on Cloudflare Workers with TypeScript and Hono.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Language:** TypeScript
- **Validation:** Zod
- **Database:** Supabase
- **LLM:** OpenRouter (via Cloudflare AI Gateway)

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars
# Fill in your secrets in .dev.vars
npm run dev
```

The dev server starts at `http://localhost:8787`.

## Deployment

```bash
npm run deploy              # default environment
npm run deploy:staging      # staging
npm run deploy:production   # production
```

Set secrets for deployed environments:

```bash
npx wrangler secret put INTERNAL_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_GATEWAY_ID
npx wrangler secret put CF_AIG_TOKEN
```

For the Twilio transcription path (see "Transcribing from a recording" below), also set:

```bash
npx wrangler secret put DEEPGRAM_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
```

`DEEPGRAM_MODEL` is a plain var in `wrangler.toml` (default `nova-3`) and needs no secret.

## Project Structure

```
src/
├── index.ts                  # Hono app entry point
├── middleware/                # Auth, CORS, request logging
├── modules/                  # Evaluation modules (full-qa, budget-inputs, warm-transfer)
│   ├── router.ts             # Routes calls to the correct module
│   └── types.ts              # Shared module types
├── routes/                   # API route handlers
│   ├── evaluate.ts           # POST /api/v1/evaluate
│   ├── batch.ts              # POST /api/v1/batch
│   └── health.ts             # GET /health
├── schemas/                  # Zod request/response schemas
├── services/                 # LLM client, database, alerts
├── types/                    # Environment bindings, text modules
└── utils/                    # Logger, retry helpers
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/evaluate` | Evaluate a single call |
| `POST` | `/api/v1/batch` | Batch evaluate multiple calls |
| `POST` | `/api/v1/evaluate/{module}/from-recording` | Transcribe a call recording, then evaluate |
| `GET` | `/health` | Health check |

### Transcribing from a recording (Twilio)

Eavesly normally receives an already-transcribed call (e.g. from Regal). The
`from-recording` variant instead accepts a **recording URL**, transcribes it with
Deepgram, and runs the same evaluation pipeline. This is additive — the existing
transcript-based endpoints are unchanged.

```
POST /api/v1/evaluate/{module}/from-recording
Authorization: Bearer <INTERNAL_API_KEY>
Content-Type: application/json

{
  "call_id": "CA123...",
  "agent_id": "agent-1",
  "recording_url": "https://api.twilio.com/2010-04-01/Accounts/AC.../Recordings/RE...",
  "recording_source": "twilio",        // optional, defaults to "twilio"
  "metadata": { "timestamp": "2026-05-27T00:00:00Z" },  // duration optional; filled from Deepgram
  "agent_email": "...",                  // optional, same optional fields as the transcript endpoint
  "sfdc_lead_id": "..."
}
```

How it works:

1. The Worker downloads the recording from Twilio with HTTP Basic Auth
   (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`); the `.mp3` representation is fetched.
2. The audio is sent to Deepgram (`/v1/listen`, `model=DEEPGRAM_MODEL`, with
   diarization + multichannel) and formatted into a speaker-labeled transcript
   (`[handling agent]:` / `[contact]:` / `[transfer agent]:`). Dual-channel recordings
   map roles by channel; mono recordings use a first-speaker heuristic.
3. The transcript flows into the normal evaluation workflow for the chosen module.

Returns `202` with a `workflow_instance_id` (or `409` if that `call_id` + module was
already submitted), same as the transcript endpoint. Note: one transcription is
performed per call; evaluating the same `call_id` against multiple modules
re-transcribes (transcript caching is a possible future optimization).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npm run deploy:staging` | Deploy to staging |
| `npm run deploy:production` | Deploy to production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run cf-typegen` | Generate Cloudflare Workers types |
