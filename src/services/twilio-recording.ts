import type { Bindings } from "../types/env"
import { log } from "../utils/logger"

/**
 * Only Twilio API hosts may receive our Basic Auth credentials: exactly
 * api.twilio.com or a regional api.<region>.twilio.com. Anything else (other
 * twilio.com subdomains, lookalike domains, http://) is rejected before the
 * SID/token are attached.
 */
export function isAllowedTwilioRecordingUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false
  const host = url.hostname
  return host === "api.twilio.com" || (host.startsWith("api.") && host.endsWith(".twilio.com"))
}

/**
 * Download a Twilio call recording. Twilio recordings are private, so this
 * authenticates with HTTP Basic Auth using the account SID + auth token.
 * The URL host/protocol is validated first so credentials can never be sent
 * to a non-Twilio host. Returns the raw mp3 bytes.
 */
export async function fetchRecording(env: Bindings, recordingUrl: string): Promise<ArrayBuffer> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)")
  }

  let parsed: URL
  try {
    parsed = new URL(recordingUrl)
  } catch {
    throw new Error("Invalid Twilio recording URL")
  }
  if (!isAllowedTwilioRecordingUrl(parsed)) {
    // Host only in the error — never echo the full untrusted URL into logs.
    throw new Error(`Refusing to send Twilio credentials to non-Twilio host: ${parsed.hostname}`)
  }
  // Append .mp3 to the path (not the raw string) so a query/fragment can't break it.
  if (!parsed.pathname.endsWith(".mp3")) parsed.pathname += ".mp3"

  const url = parsed.toString()
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) {
    log("error", "Twilio recording fetch failed", { url, status: res.status, statusText: res.statusText })
    throw new Error(`Failed to fetch Twilio recording (${res.status} ${res.statusText})`)
  }
  return await res.arrayBuffer()
}
