import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createEnv } from "../../test/helpers/mock-env"
import {
  ACHIEVE_BACKFILL_OPENAI_MAX_RETRIES,
  ACHIEVE_QA_RECOVERY_ONE_SHOT_LLM_PROFILE,
  createAchieveBackfillOneShotLlm,
  type OneShotSdkResponse,
  type OneShotStructuredSender,
} from "./achieve-backfill-one-shot-llm"

class RecordingSender implements OneShotStructuredSender {
  readonly inputs: Array<Parameters<OneShotStructuredSender["send"]>[0]> = []
  constructor(private readonly outcome: OneShotSdkResponse | Error) {}

  async send(input: Parameters<OneShotStructuredSender["send"]>[0]): Promise<OneShotSdkResponse> {
    this.inputs.push(input)
    if (this.outcome instanceof Error) throw this.outcome
    return this.outcome
  }
}

const schema = z.object({ categorical: z.literal(true) }).strict()

async function invoke(sender: RecordingSender) {
  return createAchieveBackfillOneShotLlm(createEnv(), sender).getStructuredResponse(
    "system",
    "private bounded segment",
    schema,
    "one_shot_test",
  )
}

describe("PSAI-245 dedicated one-shot LLM client", () => {
  it("configures the OpenAI SDK with zero retries", () => {
    expect(ACHIEVE_BACKFILL_OPENAI_MAX_RETRIES).toBe(0)
  })

  it.each([
    ["network failure", new Error("network unavailable")],
    ["invalid JSON", { choices: [{ message: { content: "not-json" } }] }],
    ["schema failure", { choices: [{ message: { content: JSON.stringify({ categorical: false }) } }] }],
  ])("makes exactly one SDK send on %s", async (_name, outcome) => {
    const sender = new RecordingSender(outcome)

    await expect(invoke(sender)).rejects.toThrow()
    expect(sender.inputs).toHaveLength(1)
  })

  it("preserves the frozen PSAI-245 request title by default", async () => {
    const sender = new RecordingSender({
      choices: [{ message: { content: JSON.stringify({ categorical: true }) } }],
    })

    await invoke(sender)

    expect(sender.inputs[0].requestTitle).toBe("Pennie PSAI-245 one-shot audit")
  })

  it("uses an explicit ordinary-recovery title without PSAI-245 label bleed", async () => {
    const sender = new RecordingSender({
      choices: [{ message: { content: JSON.stringify({ categorical: true }) } }],
    })

    await createAchieveBackfillOneShotLlm(
      createEnv(),
      sender,
      ACHIEVE_QA_RECOVERY_ONE_SHOT_LLM_PROFILE,
    ).getStructuredResponse("system", "private bounded segment", schema, "one_shot_test")

    expect(sender.inputs[0].requestTitle).toBe("Pennie Achieve QA gap recovery")
    expect(sender.inputs[0].requestTitle).not.toContain("PSAI-245")
  })

  it("sends OpenRouter fallback disabled and returns a valid categorical response", async () => {
    const sender = new RecordingSender({
      choices: [{ message: { content: JSON.stringify({ categorical: true }) } }],
    })

    await expect(invoke(sender)).resolves.toEqual({ categorical: true })
    expect(sender.inputs).toHaveLength(1)
    expect(sender.inputs[0].provider).toEqual({ allow_fallbacks: false })
  })
})
