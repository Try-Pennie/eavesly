import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { log } from "./logger"

describe("log", () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("outputs JSON structured log", () => {
    log("info", "test message")
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const output = infoSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.message).toBe("test message")
    expect(parsed.level).toBe("info")
    expect(parsed.timestamp).toBeTruthy()
  })

  it("uses console.log for debug level", () => {
    log("debug", "debug message")
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it("uses console.info for info level", () => {
    log("info", "info message")
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it("uses console.warn for warn level", () => {
    log("warn", "warn message")
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("uses console.error for error level", () => {
    log("error", "error message")
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it("includes context fields in output", () => {
    log("info", "with context", { correlationId: "abc-123", module: "full_qa" })
    const output = infoSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.correlationId).toBe("abc-123")
    expect(parsed.module).toBe("full_qa")
  })

  it("works with empty context", () => {
    log("info", "no context")
    const output = infoSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.message).toBe("no context")
  })

  it("includes timestamp in ISO format", () => {
    log("info", "timestamp test")
    const output = infoSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(() => new Date(parsed.timestamp)).not.toThrow()
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
