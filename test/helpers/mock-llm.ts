import { vi } from "vitest"

export function createMockLLM(response: unknown) {
  return { getStructuredResponse: vi.fn().mockResolvedValue(response) }
}

export function createFailingLLM(error = new Error("LLM failed")) {
  return { getStructuredResponse: vi.fn().mockRejectedValue(error) }
}
