import { configDefaults } from "vitest/config"
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig({
  test: {
    globals: true,
    // Keep Claude Code worktrees/state out of test discovery.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
})
