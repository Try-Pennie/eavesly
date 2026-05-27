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
