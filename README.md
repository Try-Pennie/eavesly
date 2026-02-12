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
| `GET` | `/health` | Health check |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npm run deploy:staging` | Deploy to staging |
| `npm run deploy:production` | Deploy to production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run cf-typegen` | Generate Cloudflare Workers types |
