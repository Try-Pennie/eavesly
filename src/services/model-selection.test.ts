import { describe, it, expect } from "vitest"
import { modelForEvaluation, modelForModule } from "./model-selection"
import { createEnv } from "../../test/helpers/mock-env"
import { MODULE_NAMES } from "../modules/constants"

describe("modelForModule", () => {
  it("returns DISPOSITION_REVIEW_MODEL for disposition_review when set", () => {
    const env = createEnv({ DISPOSITION_REVIEW_MODEL: "deepseek/deepseek-chat" })
    expect(modelForModule(env, MODULE_NAMES.DISPOSITION_REVIEW)).toBe(
      "deepseek/deepseek-chat",
    )
  })

  it("returns undefined for disposition_review when the var is unset (falls back to global)", () => {
    expect(modelForModule(createEnv(), MODULE_NAMES.DISPOSITION_REVIEW)).toBeUndefined()
  })

  it("returns undefined for other modules even when the var is set", () => {
    const env = createEnv({ DISPOSITION_REVIEW_MODEL: "deepseek/deepseek-chat" })
    expect(modelForModule(env, MODULE_NAMES.FULL_QA)).toBeUndefined()
  })
})

describe("modelForEvaluation", () => {
  it("uses the primary model for an explicitly configured backfill retry", () => {
    const env = createEnv({
      OPENROUTER_MODEL: "openai/gpt-4.1",
      DISPOSITION_REVIEW_MODEL: "deepseek/deepseek-chat",
    })

    expect(modelForEvaluation(env, MODULE_NAMES.DISPOSITION_REVIEW, {
      mode: "backfill",
      run_id: "retry-1",
      model_strategy: "primary",
    })).toBe("openai/gpt-4.1")
  })

  it("keeps normal disposition evaluations on their module model", () => {
    const env = createEnv({
      OPENROUTER_MODEL: "openai/gpt-4.1",
      DISPOSITION_REVIEW_MODEL: "deepseek/deepseek-chat",
    })

    expect(modelForEvaluation(env, MODULE_NAMES.DISPOSITION_REVIEW, {
      mode: "backfill",
      run_id: "retry-1",
    })).toBe("deepseek/deepseek-chat")
  })
})
