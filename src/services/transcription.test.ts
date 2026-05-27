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
