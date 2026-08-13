import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import type { z } from "zod"
import type { Bindings } from "../types/env"
import { log } from "../utils/logger"
import type { LLMClient } from "./llm-client"

/** OpenAI SDK retry count for this capability; zero forbids SDK retries. */
export const ACHIEVE_BACKFILL_OPENAI_MAX_RETRIES = 0 as const

/** Minimal SDK response shape consumed by the one-shot parser. */
export type OneShotSdkResponse = {
  readonly choices: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }>
}

/** Intentional seam around exactly one OpenAI SDK completion send. */
export interface OneShotStructuredSender {
  /** Send one request. Implementations must not retry or fall back. */
  send<T>(input: {
    readonly model: string
    readonly requestTitle: string
    readonly systemPrompt: string
    readonly userPrompt: string
    readonly schema: z.ZodType<T>
    readonly schemaName: string
    readonly temperature: number
    readonly provider: { readonly allow_fallbacks: false }
  }): Promise<OneShotSdkResponse>
}

function createOpenAiSender(env: Bindings): OneShotStructuredSender {
  const client = new OpenAI({
    apiKey: env.CF_AIG_TOKEN,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/openrouter`,
    // The SDK otherwise retries selected network/status failures internally.
    maxRetries: ACHIEVE_BACKFILL_OPENAI_MAX_RETRIES,
    defaultHeaders: {
      "HTTP-Referer": "https://trypennie.com",
    },
  })
  return {
    async send(input) {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        readonly provider: { readonly allow_fallbacks: false }
      } = {
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        response_format: zodResponseFormat(input.schema, input.schemaName),
        temperature: input.temperature,
        provider: input.provider,
      }
      return client.chat.completions.create(request, {
        headers: { "X-Title": input.requestTitle },
      })
    },
  }
}

/** Capability-specific labels for one-shot request headers and categorical logs. */
export type AchieveOneShotLlmProfile = {
  readonly requestTitle: string
  readonly logLabel: string
}

/** Frozen PSAI-245 labels retained as the default for every historical caller. */
export const PSAI245_ONE_SHOT_LLM_PROFILE: AchieveOneShotLlmProfile = {
  requestTitle: "Pennie PSAI-245 one-shot audit",
  logLabel: "PSAI-245 one-shot LLM",
}

/** Ordinary Achieve QA recovery labels, intentionally separate from PSAI-245. */
export const ACHIEVE_QA_RECOVERY_ONE_SHOT_LLM_PROFILE: AchieveOneShotLlmProfile = {
  requestTitle: "Pennie Achieve QA gap recovery",
  logLabel: "Achieve QA recovery one-shot LLM",
}

/**
 * Build an Achieve one-shot LLM client. Historical callers retain exact PSAI-245
 * labels by default; newer capabilities must supply their own explicit profile.
 *
 * It performs one sender invocation and never uses application retry helpers.
 * AI Gateway/provider retry and fallback must also be disabled operationally;
 * otherwise this only proves one application/SDK send, not one provider attempt.
 */
export function createAchieveBackfillOneShotLlm(
  env: Bindings,
  sender: OneShotStructuredSender | undefined = undefined,
  profile: AchieveOneShotLlmProfile = PSAI245_ONE_SHOT_LLM_PROFILE,
): LLMClient {
  const model = env.OPENROUTER_MODEL
  const oneShotSender = sender ?? createOpenAiSender(env)
  return {
    async getStructuredResponse<T>(
      systemPrompt: string,
      userPrompt: string,
      schema: z.ZodType<T>,
      schemaName: string,
      options: { temperature?: number } = {},
    ): Promise<T> {
      let response: OneShotSdkResponse
      try {
        response = await oneShotSender.send({
          model,
          requestTitle: profile.requestTitle,
          systemPrompt,
          userPrompt,
          schema,
          schemaName,
          temperature: options.temperature ?? 0.3,
          provider: { allow_fallbacks: false },
        })
      } catch {
        log("error", `${profile.logLabel} send failed`, { errorTag: "sdk_send_failed" })
        throw new Error("One-shot LLM send failed")
      }
      log("info", `${profile.logLabel} send completed`, { outcome: "response_received" })

      const content = response.choices[0]?.message?.content
      if (!content) {
        log("error", `${profile.logLabel} response invalid`, { errorTag: "empty_response" })
        throw new Error("One-shot LLM response invalid")
      }

      let decoded: unknown
      try {
        decoded = JSON.parse(content)
      } catch {
        log("error", `${profile.logLabel} response invalid`, { errorTag: "invalid_json" })
        throw new Error("One-shot LLM response invalid")
      }
      const parsed = schema.safeParse(decoded)
      if (!parsed.success) {
        log("error", `${profile.logLabel} response invalid`, {
          errorTag: "schema_validation_failed",
          issueCount: parsed.error.issues.length,
        })
        throw new Error("One-shot LLM response invalid")
      }
      return parsed.data
    },
  }
}
