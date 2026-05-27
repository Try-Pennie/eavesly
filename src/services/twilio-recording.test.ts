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
