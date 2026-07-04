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

    await expect(fetchRecording(env, "https://api.twilio.com/REC")).rejects.toThrow("Twilio credentials")
  })

  describe("host guard", () => {
    const env = () => createEnv({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" })

    function stubFetch() {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      })
      vi.stubGlobal("fetch", fetchMock)
      return fetchMock
    }

    it.each([
      "https://evil.example.com/REC123",
      "https://twilio.com.evil.example.com/REC123",
      "https://api.twilio.com.evil.example.com/REC123",
      "https://media.twiliocdn.com/REC123", // not an API host
      "https://www.twilio.com/REC123", // twilio.com but not api.*
      "http://api.twilio.com/REC123", // plaintext would leak Basic Auth
      "not a url",
    ])("never sends credentials to %s", async (url) => {
      const fetchMock = stubFetch()
      await expect(fetchRecording(env(), url)).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("does not include the credentials in rejection errors", async () => {
      stubFetch()
      const secretEnv = createEnv({ TWILIO_ACCOUNT_SID: "ACSECRETSID", TWILIO_AUTH_TOKEN: "SECRETTOKEN" })
      const err = await fetchRecording(secretEnv, "https://evil.example.com/REC").catch((e) => e)
      expect(String(err)).not.toContain("ACSECRETSID")
      expect(String(err)).not.toContain("SECRETTOKEN")
    })

    it("allows regional Twilio API hosts", async () => {
      const fetchMock = stubFetch()
      await fetchRecording(env(), "https://api.dublin.ie1.twilio.com/REC123")
      expect(fetchMock.mock.calls[0][0]).toBe("https://api.dublin.ie1.twilio.com/REC123.mp3")
    })

    it("appends .mp3 to the path, not the query string", async () => {
      const fetchMock = stubFetch()
      await fetchRecording(env(), "https://api.twilio.com/REC123?Download=true")
      expect(fetchMock.mock.calls[0][0]).toBe("https://api.twilio.com/REC123.mp3?Download=true")
    })
  })
})
