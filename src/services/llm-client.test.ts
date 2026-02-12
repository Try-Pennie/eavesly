import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"
import { createEnv } from "../../test/helpers/mock-env"

const mockCreate = vi.fn()

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      constructor() {}
      chat = { completions: { create: mockCreate } }
    },
  }
})

// Mock retry to pass through without delays
vi.mock("../utils/retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

import { createLLMClient } from "./llm-client"

const TestSchema = z.object({ score: z.number(), message: z.string() })

function mockLLMResponse(content: string) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

describe("createLLMClient", () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it("returns object with getStructuredResponse method", () => {
    const llm = createLLMClient(createEnv())
    expect(typeof llm.getStructuredResponse).toBe("function")
  })

  it("parses valid JSON response", async () => {
    const data = { score: 95, message: "great" }
    mockLLMResponse(JSON.stringify(data))

    const llm = createLLMClient(createEnv())
    const result = await llm.getStructuredResponse(
      "system prompt",
      "user prompt",
      TestSchema,
      "test_schema",
    )
    expect(result).toEqual(data)
  })

  it("throws on empty response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
      usage: {},
    })

    const llm = createLLMClient(createEnv())
    await expect(
      llm.getStructuredResponse("sys", "user", TestSchema, "test"),
    ).rejects.toThrow("Empty response from LLM")
  })

  it("throws on invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json {{{" } }],
      usage: {},
    })

    const llm = createLLMClient(createEnv())
    await expect(
      llm.getStructuredResponse("sys", "user", TestSchema, "test"),
    ).rejects.toThrow("LLM returned invalid JSON")
  })

  it("throws on Zod validation failure", async () => {
    mockLLMResponse(JSON.stringify({ wrong_field: true }))

    const llm = createLLMClient(createEnv())
    await expect(
      llm.getStructuredResponse("sys", "user", TestSchema, "test"),
    ).rejects.toThrow("Schema validation failed")
  })

  it("uses default temperature 0.3 and maxTokens 16000", async () => {
    const data = { score: 1, message: "ok" }
    mockLLMResponse(JSON.stringify(data))

    const llm = createLLMClient(createEnv())
    await llm.getStructuredResponse("sys", "user", TestSchema, "test")

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.3,
        max_tokens: 16000,
      }),
    )
  })

  it("passes system and user messages", async () => {
    const data = { score: 1, message: "ok" }
    mockLLMResponse(JSON.stringify(data))

    const llm = createLLMClient(createEnv())
    await llm.getStructuredResponse("my system prompt", "my user prompt", TestSchema, "test")

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "my system prompt" },
          { role: "user", content: "my user prompt" },
        ],
      }),
    )
  })

  it("uses model from env", async () => {
    const data = { score: 1, message: "ok" }
    mockLLMResponse(JSON.stringify(data))

    const llm = createLLMClient(createEnv({ OPENROUTER_MODEL: "custom-model" }))
    await llm.getStructuredResponse("sys", "user", TestSchema, "test")

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom-model" }),
    )
  })
})
