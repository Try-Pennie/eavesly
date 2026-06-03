import type { Bindings } from "../types/env"
import { log } from "../utils/logger"

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
    log("error", "Twilio recording fetch failed", { url, status: res.status, statusText: res.statusText })
    throw new Error(`Failed to fetch Twilio recording (${res.status} ${res.statusText})`)
  }
  return await res.arrayBuffer()
}
