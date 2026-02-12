import OpenAI from "openai"
import type { z } from "zod"
import type { Bindings } from "../types/env"
import { withRetry } from "../utils/retry"
import { log } from "../utils/logger"

export type LLMClient = ReturnType<typeof createLLMClient>

export function createLLMClient(env: Bindings) {
  const client = new OpenAI({
    apiKey: env.CF_AIG_TOKEN,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/openrouter`,
    defaultHeaders: {
      "HTTP-Referer": "https://trypennie.com",
      "X-Title": "Pennie Call QA System",
    },
  })

  async function getStructuredResponse<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>,
    options: { temperature?: number; maxTokens?: number } = {},
  ): Promise<T> {
    const { temperature = 0.3, maxTokens = 16000 } = options

    return withRetry(async () => {
      const response = await client.chat.completions.create({
        model: env.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
      })

      log("info", "LLM call completed", {
        model: env.OPENROUTER_MODEL,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error("Empty response from LLM")
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (parseError) {
        log("error", "LLM returned invalid JSON", {
          contentPreview: content.substring(0, 500),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        })
        throw new Error(`LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`)
      }

      const result = schema.safeParse(parsed)

      if (!result.success) {
        const topKeys = Object.keys(parsed as object)
        log("warn", "Zod validation failed, retrying", {
          errors: result.error.issues.slice(0, 5),
          responseKeys: topKeys,
          firstKey: topKeys[0] ? Object.keys((parsed as Record<string, unknown>)[topKeys[0]] ?? {}).slice(0, 5) : [],
        })
        throw new Error(
          `Schema validation failed (keys: ${topKeys.join(",")}): ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
        )
      }

      return result.data
    })
  }

  return { getStructuredResponse }
}
