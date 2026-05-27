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

    // Retry only the network/HTTP call (transient failures). The workflow step
    // retries on top of this. Content-Type is audio/mpeg because the upstream
    // always sends a Twilio .mp3 recording (see services/twilio-recording.ts).
    const json = await withRetry(async () => {
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

      return (await res.json()) as DeepgramListenResponse
    }, { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2000, timeoutMs: 300000 })

    const utterances = json.results?.utterances ?? []
    const channelCount = json.results?.channels?.length ?? 1
    const durationSec = json.metadata?.duration ?? 0

    // A 200 with no utterances (e.g. silent/too-short audio) will not improve on
    // retry, so this terminal guard lives outside withRetry to avoid wasted calls.
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
  }

  return { transcribe }
}
