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
