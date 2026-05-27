# Deepgram Transcribe-and-Evaluate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let eavesly accept a Twilio call-recording URL, transcribe it with Deepgram into a speaker-labeled transcript, and run the existing evaluation pipeline on it — without touching the live Regal path.

**Architecture:** Add a new `POST /api/v1/evaluate/{module}/from-recording` endpoint that creates the existing `EvaluationWorkflow` with a `recording` param. A new first workflow step (`transcribe-recording`) fetches the mp3 from Twilio (Basic Auth), sends bytes to Deepgram's `/v1/listen` (diarize + multichannel), formats speaker-labeled turns, and writes the transcript into `callData`. All later steps are unchanged. The Regal path (transcript already present) skips the new step.

**Tech Stack:** Cloudflare Workers + Hono + Cloudflare Workflows, TypeScript, Zod, Vitest (`@cloudflare/vitest-pool-workers`, globals enabled). Deepgram REST API. Twilio recording media API.

**Spec:** `docs/superpowers/specs/2026-05-27-deepgram-transcription-design.md` (Linear PSAI-159)

**Commit convention:** End every commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/twilio-recording.ts` | Fetch private Twilio recording mp3 with Basic Auth → `ArrayBuffer` |
| `src/services/deepgram-client.ts` | POST audio bytes to Deepgram `/v1/listen`, return normalized utterances + metadata |
| `src/services/transcript-formatter.ts` | Convert Deepgram utterances → bracket-labeled transcript string + role mapping |
| `src/services/transcription.ts` | Orchestrator: fetch → transcribe → format; `needsTranscription()` gate |
| `src/schemas/requests.ts` (modify) | Add `EvaluateFromRecordingRequestSchema` |
| `src/workflows/evaluation-workflow.ts` (modify) | Add `recording` param + `transcribe-recording` step |
| `src/routes/create-eval-routes.ts` (modify) | Register `/evaluate/{endpoint}/from-recording` |
| `src/types/env.ts` (modify) | Add Deepgram/Twilio bindings |
| `wrangler.toml` (modify) | `DEEPGRAM_MODEL` var + secrets docs |
| `test/helpers/mock-env.ts` (modify) | Test defaults for new env keys |

---

## Task 1: Configuration & env bindings

**Files:**
- Modify: `src/types/env.ts`
- Modify: `wrangler.toml:6-21` and the staging/production `[vars]`
- Modify: `test/helpers/mock-env.ts`

No tests (config only); verified by typecheck. New secrets are intentionally **NOT** added to `REQUIRED_KEYS` in `src/utils/validate-env.ts` — they are validated at point-of-use so existing Regal-only deploys keep working.

- [ ] **Step 1: Add bindings to `src/types/env.ts`**

Add these optional fields to the `Bindings` interface (after `DASHBOARD_BASE_URL?`):

```typescript
  DEEPGRAM_API_KEY?: string
  DEEPGRAM_MODEL?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
```

- [ ] **Step 2: Document secrets + add model var in `wrangler.toml`**

In the `# Secrets` comment block (after line 21) add:
```
# DEEPGRAM_API_KEY
# TWILIO_ACCOUNT_SID
# TWILIO_AUTH_TOKEN
```

In the top-level `[vars]` block (after `OPENROUTER_MODEL = "openai/gpt-4.1"`) add:
```
DEEPGRAM_MODEL = "nova-3"
```

In `[env.staging]` and `[env.production]` add `DEEPGRAM_MODEL = "nova-3"` to each `vars = { ... }` inline table.

- [ ] **Step 3: Add test defaults in `test/helpers/mock-env.ts`**

Inside the returned object (after the `SLACK_WEBHOOK_URL_FULL_QA_JOEL_NELSON` line) add:

```typescript
    DEEPGRAM_API_KEY: "test-deepgram-key",
    DEEPGRAM_MODEL: "nova-3",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/types/env.ts wrangler.toml test/helpers/mock-env.ts
git commit -m "$(cat <<'EOF'
feat: add Deepgram/Twilio env bindings and config (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Twilio recording fetch service

**Files:**
- Create: `src/services/twilio-recording.ts`
- Test: `src/services/twilio-recording.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/twilio-recording.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchRecording } from "./twilio-recording"
import { createEnv } from "../../test/helpers/mock-env"

describe("fetchRecording", () => {
  afterEach(() => vi.restoreAllMocks())

  it("fetches the .mp3 with Basic Auth", async () => {
    const buf = new ArrayBuffer(8)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      arrayBuffer: () => Promise.resolve(buf),
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = createEnv({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok" })

    const result = await fetchRecording(env, "https://api.twilio.com/REC123")

    expect(result).toBe(buf)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.twilio.com/REC123.mp3")
    expect((opts as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${btoa("AC123:tok")}`,
    })
  })

  it("does not double-append .mp3", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = createEnv({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" })

    await fetchRecording(env, "https://api.twilio.com/REC123.mp3")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.twilio.com/REC123.mp3")
  })

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }))
    const env = createEnv({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" })

    await expect(fetchRecording(env, "https://api.twilio.com/REC")).rejects.toThrow("404")
  })

  it("throws when credentials missing", async () => {
    const env = createEnv({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined })

    await expect(fetchRecording(env, "https://x")).rejects.toThrow("Twilio credentials")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/twilio-recording.test.ts`
Expected: FAIL (cannot find module `./twilio-recording`).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/twilio-recording.ts`:

```typescript
import type { Bindings } from "../types/env"

/**
 * Download a Twilio call recording. Twilio recordings are private, so this
 * authenticates with HTTP Basic Auth using the account SID + auth token.
 * Returns the raw mp3 bytes.
 */
export async function fetchRecording(env: Bindings, recordingUrl: string): Promise<ArrayBuffer> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)")
  }

  const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) {
    throw new Error(`Failed to fetch Twilio recording (${res.status} ${res.statusText})`)
  }
  return await res.arrayBuffer()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/twilio-recording.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/twilio-recording.ts src/services/twilio-recording.test.ts
git commit -m "$(cat <<'EOF'
feat: add Twilio recording fetch service (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Deepgram client service

**Files:**
- Create: `src/services/deepgram-client.ts`
- Test: `src/services/deepgram-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/deepgram-client.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest"
import { createDeepgramClient } from "./deepgram-client"
import { createEnv } from "../../test/helpers/mock-env"

const sampleResponse = {
  metadata: { duration: 42.5 },
  results: {
    channels: [{}],
    utterances: [
      { speaker: 0, channel: 0, transcript: "Hi there", start: 0, end: 1 },
      { speaker: 1, channel: 0, transcript: "Hello", start: 1, end: 2 },
    ],
  },
}

describe("createDeepgramClient.transcribe", () => {
  afterEach(() => vi.restoreAllMocks())

  it("posts audio with correct params and parses utterances", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(sampleResponse),
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = createEnv({ DEEPGRAM_API_KEY: "dg-key", DEEPGRAM_MODEL: "nova-3" })
    const audio = new ArrayBuffer(16)

    const result = await createDeepgramClient(env).transcribe(audio)

    expect(result.durationSec).toBe(42.5)
    expect(result.channelCount).toBe(1)
    expect(result.utterances).toHaveLength(2)
    expect(result.utterances[0]).toMatchObject({ speaker: 0, channel: 0, transcript: "Hi there" })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain("model=nova-3")
    expect(url).toContain("diarize=true")
    expect(url).toContain("multichannel=true")
    expect(url).toContain("utterances=true")
    expect((opts as RequestInit).method).toBe("POST")
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: "Token dg-key" })
    expect((opts as RequestInit).body).toBe(audio)
  })

  it("throws when no utterances returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ metadata: { duration: 1 }, results: { channels: [{}], utterances: [] } }),
    }))
    const env = createEnv({ DEEPGRAM_API_KEY: "k" })

    await expect(createDeepgramClient(env).transcribe(new ArrayBuffer(1))).rejects.toThrow("no utterances")
  })

  it("throws when API key missing", async () => {
    const env = createEnv({ DEEPGRAM_API_KEY: undefined })

    await expect(createDeepgramClient(env).transcribe(new ArrayBuffer(1))).rejects.toThrow("DEEPGRAM_API_KEY")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/deepgram-client.test.ts`
Expected: FAIL (cannot find module `./deepgram-client`).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/deepgram-client.ts`:

```typescript
import type { Bindings } from "../types/env"
import { withRetry } from "../utils/retry"
import { log } from "../utils/logger"

export interface DeepgramUtterance {
  speaker?: number
  channel: number
  transcript: string
  start: number
  end: number
}

export interface DeepgramResult {
  utterances: DeepgramUtterance[]
  channelCount: number
  durationSec: number
}

interface DeepgramListenResponse {
  metadata?: { duration?: number }
  results?: {
    channels?: unknown[]
    utterances?: Array<{
      speaker?: number
      channel?: number
      transcript: string
      start: number
      end: number
    }>
  }
}

export type DeepgramClient = ReturnType<typeof createDeepgramClient>

export function createDeepgramClient(env: Bindings) {
  async function transcribe(audio: ArrayBuffer): Promise<DeepgramResult> {
    if (!env.DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY not configured")
    }

    const model = env.DEEPGRAM_MODEL || "nova-3"
    const params = new URLSearchParams({
      model,
      diarize: "true",
      utterances: "true",
      punctuate: "true",
      smart_format: "true",
      multichannel: "true",
    })
    const url = `https://api.deepgram.com/v1/listen?${params.toString()}`

    // Modest client-level retry; the workflow step retries on top of this.
    return withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
          "Content-Type": "audio/mpeg",
        },
        body: audio,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`Deepgram request failed (${res.status}): ${text.slice(0, 300)}`)
      }

      const json = (await res.json()) as DeepgramListenResponse
      const utterances = json.results?.utterances ?? []
      const channelCount = json.results?.channels?.length ?? 1
      const durationSec = json.metadata?.duration ?? 0

      if (utterances.length === 0) {
        throw new Error("Deepgram returned no utterances")
      }

      log("info", "Deepgram transcription completed", {
        model, durationSec, utteranceCount: utterances.length, channelCount,
      })

      return {
        utterances: utterances.map((u) => ({
          speaker: u.speaker,
          channel: u.channel ?? 0,
          transcript: u.transcript,
          start: u.start,
          end: u.end,
        })),
        channelCount,
        durationSec,
      }
    }, { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2000, timeoutMs: 300000 })
  }

  return { transcribe }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/deepgram-client.test.ts`
Expected: PASS (3 tests). The two error tests retry with short delays (~0.75s each).

- [ ] **Step 5: Commit**

```bash
git add src/services/deepgram-client.ts src/services/deepgram-client.test.ts
git commit -m "$(cat <<'EOF'
feat: add Deepgram transcription client (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Transcript formatter + speaker→role mapping

**Files:**
- Create: `src/services/transcript-formatter.ts`
- Test: `src/services/transcript-formatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/transcript-formatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { formatTranscript } from "./transcript-formatter"
import type { DeepgramResult } from "./deepgram-client"

function result(over: Partial<DeepgramResult>): DeepgramResult {
  return { utterances: [], channelCount: 1, durationSec: 0, ...over }
}

describe("formatTranscript", () => {
  it("uses channel mapping when dual-channel", () => {
    const r = result({
      channelCount: 2,
      utterances: [
        { speaker: 0, channel: 0, transcript: "Agent line", start: 0, end: 1 },
        { speaker: 0, channel: 1, transcript: "Contact line", start: 1, end: 2 },
      ],
    })

    expect(formatTranscript(r).transcript).toBe(
      "[handling agent]: Agent line\n[contact]: Contact line",
    )
  })

  it("uses first-speaker heuristic when mono diarized", () => {
    const r = result({
      channelCount: 1,
      utterances: [
        { speaker: 0, channel: 0, transcript: "First", start: 0, end: 1 },
        { speaker: 1, channel: 0, transcript: "Second", start: 1, end: 2 },
        { speaker: 0, channel: 0, transcript: "Again agent", start: 2, end: 3 },
        { speaker: 2, channel: 0, transcript: "Third party", start: 3, end: 4 },
      ],
    })

    expect(formatTranscript(r).transcript).toBe(
      "[handling agent]: First\n[contact]: Second\n[handling agent]: Again agent\n[transfer agent]: Third party",
    )
  })

  it("filters blank utterances and passes duration through", () => {
    const r = result({
      channelCount: 1,
      durationSec: 99,
      utterances: [
        { speaker: 0, channel: 0, transcript: "   ", start: 0, end: 1 },
        { speaker: 0, channel: 0, transcript: "Real", start: 1, end: 2 },
      ],
    })

    const out = formatTranscript(r)
    expect(out.transcript).toBe("[handling agent]: Real")
    expect(out.durationSec).toBe(99)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/transcript-formatter.test.ts`
Expected: FAIL (cannot find module `./transcript-formatter`).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/transcript-formatter.ts`:

```typescript
import type { DeepgramResult, DeepgramUtterance } from "./deepgram-client"

export interface FormattedTranscript {
  transcript: string
  durationSec: number
}

const AGENT_LABEL = "handling agent"
const CONTACT_LABEL = "contact"
const TRANSFER_LABEL = "transfer agent"

/**
 * Build a speaker-labeled transcript matching the format the eval prompts expect
 * ("[handling agent]:", "[contact]:", "[transfer agent]:").
 *
 * Role mapping is two-tier:
 *  - Dual-channel (channelCount >= 2): deterministic by channel. Twilio dual-channel
 *    recordings put each leg on its own channel; we assume channel 0 = handling agent.
 *  - Mono + diarization: heuristic — the FIRST speaker to talk is treated as the
 *    handling agent (outbound calls open with the agent), the second as the contact,
 *    any others as transfer agents.
 *
 * Both mappings can mislabel; the eval prompts independently re-derive roles from
 * speaker patterns, so a mislabel degrades gracefully rather than breaking evaluation.
 */
export function formatTranscript(result: DeepgramResult): FormattedTranscript {
  const valid = result.utterances.filter((u) => u.transcript.trim().length > 0)
  const labelFor = result.channelCount >= 2 ? makeChannelLabeler() : makeSpeakerLabeler()
  const lines = valid.map((u) => `[${labelFor(u)}]: ${u.transcript.trim()}`)
  return { transcript: lines.join("\n"), durationSec: result.durationSec }
}

function makeChannelLabeler(): (u: DeepgramUtterance) => string {
  return (u) => {
    if (u.channel === 0) return AGENT_LABEL
    if (u.channel === 1) return CONTACT_LABEL
    return `${TRANSFER_LABEL} ${u.channel}`
  }
}

function makeSpeakerLabeler(): (u: DeepgramUtterance) => string {
  const order: number[] = []
  return (u) => {
    const id = u.speaker ?? 0
    if (!order.includes(id)) order.push(id)
    const idx = order.indexOf(id)
    if (idx === 0) return AGENT_LABEL
    if (idx === 1) return CONTACT_LABEL
    return TRANSFER_LABEL
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/transcript-formatter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/transcript-formatter.ts src/services/transcript-formatter.test.ts
git commit -m "$(cat <<'EOF'
feat: add transcript formatter with speaker-role mapping (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Transcription orchestrator + gate

**Files:**
- Create: `src/services/transcription.ts`
- Test: `src/services/transcription.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/transcription.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("./twilio-recording", () => ({ fetchRecording: vi.fn() }))
vi.mock("./deepgram-client", () => ({ createDeepgramClient: vi.fn() }))
vi.mock("./transcript-formatter", () => ({ formatTranscript: vi.fn() }))

import { fetchRecording } from "./twilio-recording"
import { createDeepgramClient } from "./deepgram-client"
import { formatTranscript } from "./transcript-formatter"
import { transcribeRecording, needsTranscription } from "./transcription"
import { createEnv } from "../../test/helpers/mock-env"

describe("transcribeRecording", () => {
  afterEach(() => vi.restoreAllMocks())

  it("composes fetch -> deepgram -> format", async () => {
    const audio = new ArrayBuffer(4)
    const dgResult = { utterances: [], channelCount: 1, durationSec: 5 }
    const formatted = { transcript: "[handling agent]: hi", durationSec: 5 }
    ;(fetchRecording as any).mockResolvedValue(audio)
    const transcribe = vi.fn().mockResolvedValue(dgResult)
    ;(createDeepgramClient as any).mockReturnValue({ transcribe })
    ;(formatTranscript as any).mockReturnValue(formatted)
    const env = createEnv()

    const out = await transcribeRecording(env, "https://api.twilio.com/REC")

    expect(fetchRecording).toHaveBeenCalledWith(env, "https://api.twilio.com/REC")
    expect(transcribe).toHaveBeenCalledWith(audio)
    expect(formatTranscript).toHaveBeenCalledWith(dgResult)
    expect(out).toBe(formatted)
  })
})

describe("needsTranscription", () => {
  const base = { call_id: "c", agent_id: "a" } as any

  it("true when recording present and transcript empty", () => {
    expect(needsTranscription({ ...base, transcript: { transcript: "", metadata: {} } }, { url: "u" })).toBe(true)
  })

  it("false when transcript already present", () => {
    expect(needsTranscription({ ...base, transcript: { transcript: "hello", metadata: {} } }, { url: "u" })).toBe(false)
  })

  it("false when no recording", () => {
    expect(needsTranscription({ ...base, transcript: { transcript: "", metadata: {} } }, undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/transcription.test.ts`
Expected: FAIL (cannot find module `./transcription`).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/transcription.ts`:

```typescript
import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import { fetchRecording } from "./twilio-recording"
import { createDeepgramClient } from "./deepgram-client"
import { formatTranscript, type FormattedTranscript } from "./transcript-formatter"

/** Fetch a recording from Twilio, transcribe it with Deepgram, and format it. */
export async function transcribeRecording(
  env: Bindings,
  recordingUrl: string,
): Promise<FormattedTranscript> {
  const audio = await fetchRecording(env, recordingUrl)
  const result = await createDeepgramClient(env).transcribe(audio)
  return formatTranscript(result)
}

/** True when we have a recording to transcribe and no transcript yet (Twilio path). */
export function needsTranscription(
  callData: EvaluateRequest,
  recording?: { url: string },
): boolean {
  return !!recording?.url && !callData.transcript?.transcript?.trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/transcription.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/transcription.ts src/services/transcription.test.ts
git commit -m "$(cat <<'EOF'
feat: add transcription orchestrator and gate (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: From-recording request schema

**Files:**
- Modify: `src/schemas/requests.ts`
- Test: `src/schemas/requests.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/schemas/requests.test.ts` (append a new describe block at the end of the file):

```typescript
import { EvaluateFromRecordingRequestSchema } from "./requests"

describe("EvaluateFromRecordingRequestSchema", () => {
  const valid = {
    call_id: "rec-1",
    agent_id: "agent-1",
    recording_url: "https://api.twilio.com/REC123",
    metadata: { timestamp: "2025-01-01T00:00:00Z" },
  }

  it("accepts a minimal valid body and defaults recording_source", () => {
    const parsed = EvaluateFromRecordingRequestSchema.parse(valid)
    expect(parsed.recording_source).toBe("twilio")
    expect(parsed.metadata.duration).toBeUndefined()
  })

  it("rejects a body missing recording_url", () => {
    const { recording_url, ...rest } = valid
    expect(EvaluateFromRecordingRequestSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects a non-URL recording_url", () => {
    expect(EvaluateFromRecordingRequestSchema.safeParse({ ...valid, recording_url: "not-a-url" }).success).toBe(false)
  })
})
```

> Note: `src/schemas/requests.test.ts` already imports `describe/it/expect` (globals enabled) — only add the `EvaluateFromRecordingRequestSchema` import if it is not already imported alongside the existing schema imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/schemas/requests.test.ts`
Expected: FAIL (`EvaluateFromRecordingRequestSchema` is not exported).

- [ ] **Step 3: Write minimal implementation**

Add to `src/schemas/requests.ts` (after the `BatchEvaluateRequestSchema` block):

```typescript
const FromRecordingMetadataSchema = z.object({
  timestamp: z.string(),
  duration: z.coerce.number().nonnegative().optional(),
  talk_time: z.coerce.number().nonnegative().optional(),
  disposition: z.string().optional(),
  campaign_name: z.string().optional(),
})

export const EvaluateFromRecordingRequestSchema = z.object({
  call_id: z.string().min(1),
  agent_id: z.string(),
  recording_url: z.string().url(),
  recording_source: z.literal("twilio").default("twilio"),
  metadata: FromRecordingMetadataSchema,
  agent_email: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  call_summary: z.string().optional(),
  transcript_url: z.string().optional(),
  sfdc_lead_id: z.string().optional(),
})

export type EvaluateFromRecordingRequest = z.infer<typeof EvaluateFromRecordingRequestSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/schemas/requests.test.ts`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/schemas/requests.ts src/schemas/requests.test.ts
git commit -m "$(cat <<'EOF'
feat: add EvaluateFromRecordingRequestSchema (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Workflow transcribe step

**Files:**
- Modify: `src/workflows/evaluation-workflow.ts`
- Test: `src/workflows/evaluation-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/workflows/evaluation-workflow.test.ts`:

```typescript
import { needsTranscription } from "../services/transcription"

describe("transcribe step wiring", () => {
  const withRecording = {
    call_id: "rec-1",
    agent_id: "a",
    transcript: { transcript: "", metadata: { duration: 0, timestamp: "2025-01-01T00:00:00Z" } },
  } as any

  it("gates transcription on empty transcript + recording present", () => {
    expect(needsTranscription(withRecording, { url: "https://api.twilio.com/REC" })).toBe(true)
    expect(needsTranscription({ ...withRecording, transcript: { transcript: "done", metadata: {} } }, { url: "x" })).toBe(false)
  })

  it("assembles callData.transcript from a transcription result, preserving metadata", () => {
    const callData = {
      ...withRecording,
      transcript: { transcript: "", metadata: { duration: 0, timestamp: "2025-01-01T00:00:00Z" } },
    }
    const transcribed = { transcript: "[handling agent]: hi", durationSec: 88 }

    // Mirrors the assignment the workflow performs after the transcribe step.
    callData.transcript = {
      transcript: transcribed.transcript,
      metadata: { ...callData.transcript.metadata, duration: transcribed.durationSec },
    }

    expect(callData.transcript.transcript).toBe("[handling agent]: hi")
    expect(callData.transcript.metadata.duration).toBe(88)
    expect(callData.transcript.metadata.timestamp).toBe("2025-01-01T00:00:00Z")
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/workflows/evaluation-workflow.test.ts`
Expected: PASS. Unlike a normal red-green step, this test exercises `needsTranscription` (built in Task 5) and a pure assignment simulation, so it passes immediately — it locks in the contract the workflow wiring must honor.

> Why no failing-first test for the wiring itself: `EvaluationWorkflow` (a `WorkflowEntrypoint`) cannot be instantiated in the Workers test pool, so the actual step wiring is verified by `npm run typecheck` in Step 4 plus the gating/assignment tests above — matching the existing "simulate the step" test style already used in this file.

- [ ] **Step 3: Wire the workflow**

In `src/workflows/evaluation-workflow.ts`:

a) Add import after the existing service imports (e.g. after the `createLLMClient` import):

```typescript
import { transcribeRecording, needsTranscription } from "../services/transcription"
```

b) Extend the params type:

```typescript
type EvaluationParams = {
  moduleName: string
  callData: EvaluateRequest
  correlationId: string
  recording?: { url: string; source: "twilio" }
}
```

c) Update the destructure at the top of `run()`:

```typescript
    const { moduleName, callData, correlationId, recording } = event.payload
```

d) Insert this block immediately after `const mod = getModule(moduleName)` and BEFORE the `// Step 0: Fetch prior call context` step:

```typescript
    // Step 0a: Transcribe recording (Twilio path only). The Regal path already
    // supplies a transcript, so this is skipped there.
    if (needsTranscription(callData, recording)) {
      const transcribed = await step.do("transcribe-recording", {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      }, async () => {
        return await transcribeRecording(this.env, recording!.url)
      })

      callData.transcript = {
        transcript: transcribed.transcript,
        metadata: { ...callData.transcript.metadata, duration: transcribed.durationSec },
      }
    }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- src/workflows/evaluation-workflow.test.ts && npm run typecheck`
Expected: PASS (existing tests + new describe block) and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/evaluation-workflow.ts src/workflows/evaluation-workflow.test.ts
git commit -m "$(cat <<'EOF'
feat: transcribe recording in evaluation workflow when no transcript (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: From-recording route

**Files:**
- Modify: `src/routes/create-eval-routes.ts`
- Test: `src/routes/create-eval-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new describe block inside the existing `describe.each(modules)(...)` callback in `src/routes/create-eval-routes.test.ts` (after the `POST /evaluate/${endpoint}/batch` describe block, still inside the `.each` body so `endpoint`/`moduleName` are in scope):

```typescript
  describe(`POST /evaluate/${endpoint}/from-recording`, () => {
    const validRecordingBody = {
      call_id: "rec-call-1",
      agent_id: "agent-456",
      recording_url: "https://api.twilio.com/REC123",
      metadata: { timestamp: "2025-01-01T00:00:00Z" },
    }

    it("returns 401 without auth", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRecordingBody),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(401)
    })

    it("returns 400 without recording_url", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify({ call_id: "x", agent_id: "y", metadata: { timestamp: "t" } }),
      }, createEnvWithWorkflow())
      expect(res.status).toBe(400)
    })

    it("returns 202 and passes the recording param to the workflow", async () => {
      const app = createApp(endpoint, moduleName)
      const res = await app.request(`/api/v1/evaluate/${endpoint}/from-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify(validRecordingBody),
      }, createEnvWithWorkflow())

      expect(res.status).toBe(202)
      const body = (await res.json()) as any
      expect(body.module).toBe(moduleName)
      expect(body.status).toBe("queued")

      const createArgs = mockWorkflowCreate.mock.calls[0][0]
      expect(createArgs.id).toBe(`rec-call-1-${moduleName}`)
      expect(createArgs.params.recording).toEqual({ url: "https://api.twilio.com/REC123", source: "twilio" })
      expect(createArgs.params.callData.transcript.transcript).toBe("")
      expect(createArgs.params.callData.recording_link).toBe("https://api.twilio.com/REC123")
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/routes/create-eval-routes.test.ts`
Expected: FAIL (404/no route → status not 202/400 as asserted).

- [ ] **Step 3: Write minimal implementation**

In `src/routes/create-eval-routes.ts`:

a) Extend the imports from `../schemas/requests`:

```typescript
import {
  EvaluateRequestSchema,
  BatchEvaluateRequestSchema,
  EvaluateFromRecordingRequestSchema,
} from "../schemas/requests"
import type { EvaluateRequest } from "../schemas/requests"
```

b) Add this route handler inside `createEvalRoutes`, after the `/evaluate/${endpoint}/batch` route and before `return routes`:

```typescript
  routes.post(`/evaluate/${endpoint}/from-recording`, async (c) => {
    const db = new DatabaseService(c.env)
    const correlationId = c.get("correlationId")

    let rawBody: string
    try {
      rawBody = await c.req.text()
    } catch (e) {
      await db.logRequest({
        endpoint,
        status: "body_read_error",
        statusCode: 400,
        errorMessage: e instanceof Error ? e.message : String(e),
        correlationId,
      })
      return c.json({ error: "Failed to read request body" }, 400)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch (e) {
      await db.logRequest({
        endpoint,
        status: "json_parse_error",
        statusCode: 400,
        errorMessage: e instanceof Error ? e.message : String(e),
        rawBody,
        correlationId,
      })
      return c.json({ error: "Invalid JSON" }, 400)
    }

    const validation = EvaluateFromRecordingRequestSchema.safeParse(parsed)
    if (!validation.success) {
      await db.logRequest({
        endpoint,
        callId: (parsed as any)?.call_id,
        status: "validation_error",
        statusCode: 400,
        errorMessage: validation.error.message,
        errorDetails: validation.error.issues,
        rawBody,
        correlationId,
      })
      return c.json({ error: "Validation failed", details: validation.error.issues }, 400)
    }

    const data = validation.data
    const callData: EvaluateRequest = {
      call_id: data.call_id,
      agent_id: data.agent_id,
      transcript: {
        transcript: "",
        metadata: {
          duration: data.metadata.duration ?? 0,
          timestamp: data.metadata.timestamp,
          talk_time: data.metadata.talk_time,
          disposition: data.metadata.disposition,
          campaign_name: data.metadata.campaign_name,
        },
      },
      agent_email: data.agent_email,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      recording_link: data.recording_url,
      call_summary: data.call_summary,
      transcript_url: data.transcript_url,
      sfdc_lead_id: data.sfdc_lead_id,
    }

    await db.logRequest({
      endpoint,
      callId: data.call_id,
      status: "received_recording",
      correlationId,
    })

    const instanceId = `${data.call_id}-${moduleName}`

    try {
      const instance = await c.env.EVALUATION_WORKFLOW.create({
        id: instanceId,
        params: {
          moduleName,
          callData,
          correlationId,
          recording: { url: data.recording_url, source: data.recording_source },
        },
      })

      return c.json({
        call_id: data.call_id,
        module: moduleName,
        correlation_id: correlationId,
        workflow_instance_id: instance.id,
        status: "queued",
        timestamp: new Date().toISOString(),
      }, 202)
    } catch (e) {
      if (e instanceof Error && e.message.includes("already exists")) {
        return c.json({
          call_id: data.call_id,
          module: moduleName,
          workflow_instance_id: instanceId,
          status: "already_exists",
          message: "Evaluation already submitted for this call_id",
        }, 409)
      }
      throw e
    }
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/routes/create-eval-routes.test.ts`
Expected: PASS (existing tests + 3 new per module).

- [ ] **Step 5: Commit**

```bash
git add src/routes/create-eval-routes.ts src/routes/create-eval-routes.test.ts
git commit -m "$(cat <<'EOF'
feat: add /evaluate/{module}/from-recording endpoint (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full verification + docs

**Files:**
- Modify: `docs/database_schema.md` (or `README.md` if present) — document the new endpoint

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites, including the new service/schema/route tests).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Document the endpoint**

Add a short section to `docs/database_schema.md` (or the repo README) describing:
- `POST /api/v1/evaluate/{module}/from-recording` — body `{ call_id, agent_id, recording_url, recording_source?, metadata: { timestamp, duration? }, ...optional Regal-equivalent fields }`.
- Behavior: fetches the Twilio recording, transcribes via Deepgram (speaker-labeled), then runs the same evaluation workflow as the transcript endpoint.
- Required secrets: `DEEPGRAM_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`; var `DEEPGRAM_MODEL` (default `nova-3`).
- Note: one transcription per call; calling multiple modules for the same `call_id` re-transcribes.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: document from-recording transcription endpoint (PSAI-159)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Deployment notes (post-merge, manual)

Before the new endpoint works in staging/production, set the secrets per environment:

```bash
wrangler secret put DEEPGRAM_API_KEY --env staging
wrangler secret put TWILIO_ACCOUNT_SID --env staging
wrangler secret put TWILIO_AUTH_TOKEN --env staging
# repeat with --env production
```

`DEEPGRAM_MODEL` is set as a plain var in `wrangler.toml` and needs no secret.
