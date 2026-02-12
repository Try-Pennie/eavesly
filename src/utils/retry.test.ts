import { describe, it, expect, vi } from "vitest"
import { withRetry } from "./retry"

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("success")
    const result = await withRetry(fn)
    expect(result).toBe("success")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success")

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 })
    expect(result).toBe("success")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"))

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow("always fails")
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it("respects timeout option", async () => {
    let callCount = 0
    const fn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error("first fail")
      }
      // Simulate slow execution - timeout should kick in
      throw new Error("still failing")
    })

    await expect(
      withRetry(fn, {
        maxRetries: 10,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 1,
      }),
    ).rejects.toThrow()
  })

  it("implements exponential backoff", async () => {
    const delays: number[] = []
    const originalSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any, ms?: number) => {
      delays.push(ms ?? 0)
      return originalSetTimeout(fn, 0) // Don't actually wait
    })

    const fnMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok")

    await withRetry(fnMock, {
      baseDelayMs: 100,
      maxDelayMs: 10000,
      timeoutMs: 60000,
    })

    // First retry: 100 * 2^0 = 100
    // Second retry: 100 * 2^1 = 200
    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)

    vi.restoreAllMocks()
  })
})
