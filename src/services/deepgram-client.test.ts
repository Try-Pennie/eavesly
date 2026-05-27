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

  it("maps channelCount from a multichannel response", async () => {
    const dual = {
      metadata: { duration: 10 },
      results: {
        channels: [{}, {}],
        utterances: [
          { speaker: 0, channel: 0, transcript: "Agent", start: 0, end: 1 },
          { speaker: 0, channel: 1, transcript: "Contact", start: 1, end: 2 },
        ],
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(dual),
    }))
    const env = createEnv({ DEEPGRAM_API_KEY: "k" })

    const result = await createDeepgramClient(env).transcribe(new ArrayBuffer(4))

    expect(result.channelCount).toBe(2)
    expect(result.utterances[1]).toMatchObject({ channel: 1, transcript: "Contact" })
  })

  it("throws on non-ok response without parsing JSON as a result", async () => {
    const json = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 429, statusText: "Too Many Requests",
      text: () => Promise.resolve("rate limited"),
      json,
    }))
    const env = createEnv({ DEEPGRAM_API_KEY: "k" })

    await expect(createDeepgramClient(env).transcribe(new ArrayBuffer(1))).rejects.toThrow("429")
    expect(json).not.toHaveBeenCalled()
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
