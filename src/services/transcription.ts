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
