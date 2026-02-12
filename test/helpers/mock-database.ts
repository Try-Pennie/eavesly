import { vi } from "vitest"

export function createMockDB() {
  return {
    storeModuleResult: vi.fn().mockResolvedValue(undefined),
    storeQAResult: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  }
}

export function createFailingDB(error = new Error("Database error")) {
  return {
    storeModuleResult: vi.fn().mockRejectedValue(error),
    storeQAResult: vi.fn().mockRejectedValue(error),
    healthCheck: vi.fn().mockResolvedValue(false),
  }
}
