/**
 * Achieve GOTA prompt regression harness.
 *
 * Runs PII-free labeled calls through the production prompt and schema, then
 * through finalizeGotaCheck() so violation and missing-beat scoring use the same
 * server-owned rules as production.
 *
 * Usage:
 *   npm run eval:gota
 *   npm run eval:gota -- openai/gpt-4.1 deepseek/deepseek-chat
 *
 * Requires CF_ACCOUNT_ID, CF_GATEWAY_ID, and CF_AIG_TOKEN. With the Pennie cfp
 * profile, `npm run eval:gota:cf` supplies them automatically.
 */
import { config } from "dotenv"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import { GotaCheckSchema, type GotaCheckResult } from "../src/schemas/gota-check"
import { buildUserPrompt } from "../src/modules/types"
import { finalizeGotaCheck } from "../src/modules/gota-check/logic"
import { GOTA_EVAL_CASES, type GotaEvalCase } from "./eval-cases/gota-check-cases"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

config({ path: resolve(ROOT, ".dev.vars") })
config({ path: resolve(ROOT, ".env.test") })

const { CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN } = process.env
if (!CF_ACCOUNT_ID || !CF_GATEWAY_ID || !CF_AIG_TOKEN) {
  console.error(
    "Missing CF_ACCOUNT_ID / CF_GATEWAY_ID / CF_AIG_TOKEN. Use `npm run eval:gota:cf` or add them to .dev.vars.",
  )
  process.exit(1)
}

const DEFAULT_MODELS = ["openai/gpt-4.1"]
const requestedModels = process.argv.slice(2).filter((argument) => !argument.startsWith("-"))
const models = requestedModels.length > 0 ? requestedModels : DEFAULT_MODELS
const SYSTEM_PROMPT = readFileSync(resolve(ROOT, "prompts/gota-check.txt"), "utf8")
const BASE_PROMPT =
  "Please evaluate the following Achieve enrollment call transcript for GOTA (Going Over The Agreement) signing-walkthrough compliance:"

const client = new OpenAI({
  apiKey: CF_AIG_TOKEN,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openrouter`,
  defaultHeaders: {
    "HTTP-Referer": "https://trypennie.com",
    "X-Title": "Pennie Call QA System",
  },
})

interface RunResult {
  readonly latencyMs: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly result: GotaCheckResult | null
  readonly parseError: string | null
  readonly error: string | null
}

async function runOne(model: string, evalCase: GotaEvalCase): Promise<RunResult> {
  const userPrompt = buildUserPrompt(BASE_PROMPT, evalCase.transcript)
  const startedAt = Date.now()
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(GotaCheckSchema, "gota_check_evaluation"),
      temperature: 0.3,
    })
    const latencyMs = Date.now() - startedAt
    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const content = response.choices[0]?.message?.content
    if (!content) {
      return { latencyMs, promptTokens, completionTokens, result: null, parseError: "empty response", error: null }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return { latencyMs, promptTokens, completionTokens, result: null, parseError: `invalid json: ${message}`, error: null }
    }

    const validated = GotaCheckSchema.safeParse(parsed)
    if (!validated.success) {
      const detail = validated.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
      return { latencyMs, promptTokens, completionTokens, result: null, parseError: `schema: ${detail}`, error: null }
    }

    return {
      latencyMs,
      promptTokens,
      completionTokens,
      result: finalizeGotaCheck(validated.data, evalCase.transcript),
      parseError: null,
      error: null,
    }
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      result: null,
      parseError: null,
      error: message,
    }
  }
}

interface Check {
  readonly field: string
  readonly ok: boolean
  readonly got: string
  readonly want: string
}

function exactCheck(field: string, got: boolean | string, want: boolean | string): Check {
  return { field, ok: got === want, got: String(got), want: String(want) }
}

function scoreCase(evalCase: GotaEvalCase, result: GotaCheckResult): ReadonlyArray<Check> {
  const expected = evalCase.expect
  const checks: Check[] = [
    exactCheck("enrollment_completed", result.enrollment_completed, expected.enrollment_completed),
    exactCheck("gota_conducted", result.gota_conducted, expected.gota_conducted),
    exactCheck("violation", result.violation, expected.violation),
  ]

  if (expected.gota_type !== undefined) {
    checks.push(exactCheck("gota_type", result.gota_type, expected.gota_type))
  }
  if (expected.wc_transfer_occurred !== undefined) {
    checks.push(exactCheck("wc_transfer_occurred", result.wc_transfer_occurred, expected.wc_transfer_occurred))
  }
  if (expected.beats !== undefined) {
    for (const field of BEAT_FIELDS) {
      const want = expected.beats[field]
      if (want !== undefined) {
        checks.push(exactCheck(field, result[field], want))
      }
    }
  }
  return checks
}

const BEAT_FIELDS = [
  "fee_structure_beat_covered",
  "cancellation_rights_beat_covered",
  "do_not_sign_page_beat_covered",
  "banking_readback_beat_covered",
  "ssn_verification_beat_covered",
  "wc_transfer_brief_beat_covered",
] as const

const EVIDENCE_FIELDS = [
  "enrollment_evidence_quote",
  "gota_evidence_quote",
  "fee_structure_evidence",
  "cancellation_rights_evidence",
  "do_not_sign_page_evidence",
  "banking_readback_evidence",
  "ssn_verification_evidence",
  "wc_transfer_brief_evidence",
  "wc_transfer_evidence_quote",
  "key_evidence_quote",
] as const satisfies ReadonlyArray<keyof GotaCheckResult>

function fabricatedQuoteCount(evalCase: GotaEvalCase, result: GotaCheckResult): number {
  const transcript = evalCase.transcript.toLowerCase().replace(/\s+/g, " ").trim()
  let count = 0
  for (const field of EVIDENCE_FIELDS) {
    const quote = result[field]
    if (typeof quote !== "string") continue
    const normalized = quote.toLowerCase().replace(/\s+/g, " ").trim()
    if (normalized.length > 0 && !transcript.includes(normalized)) count++
  }
  return count
}

interface ModelSummary {
  readonly model: string
  cases: number
  apiErrors: number
  parseFailures: number
  checksTotal: number
  checksPassed: number
  fabricatedQuotes: number
  totalLatencyMs: number
  totalPromptTokens: number
  totalCompletionTokens: number
}

interface ReportRun {
  readonly case: string
  readonly latencyMs?: number
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly fabricatedQuotes?: number
  readonly result?: GotaCheckResult
  readonly checks?: ReadonlyArray<Check>
  readonly error?: string
  readonly parseError?: string
}

async function main(): Promise<void> {
  console.log(`\nAchieve GOTA eval — ${GOTA_EVAL_CASES.length} cases × ${models.length} model(s)`)
  console.log(`Models: ${models.join(", ")}\n`)

  const summaries: ModelSummary[] = []
  const reportModels: Record<string, { runs: ReportRun[]; summary?: Record<string, string | number> }> = {}

  for (const model of models) {
    console.log(`━━━ ${model} ━━━`)
    const summary: ModelSummary = {
      model,
      cases: GOTA_EVAL_CASES.length,
      apiErrors: 0,
      parseFailures: 0,
      checksTotal: 0,
      checksPassed: 0,
      fabricatedQuotes: 0,
      totalLatencyMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
    }
    const runs: ReportRun[] = []
    reportModels[model] = { runs }

    for (const evalCase of GOTA_EVAL_CASES) {
      const run = await runOne(model, evalCase)
      summary.totalLatencyMs += run.latencyMs
      summary.totalPromptTokens += run.promptTokens
      summary.totalCompletionTokens += run.completionTokens

      if (run.error !== null) {
        summary.apiErrors++
        console.log(`  ✗ ${evalCase.name.padEnd(38)} API ERROR: ${run.error.slice(0, 80)}`)
        runs.push({ case: evalCase.name, error: run.error })
        continue
      }
      if (run.result === null) {
        summary.parseFailures++
        console.log(`  ✗ ${evalCase.name.padEnd(38)} PARSE FAIL: ${run.parseError}`)
        runs.push({ case: evalCase.name, parseError: run.parseError ?? "unknown parse failure" })
        continue
      }

      const checks = scoreCase(evalCase, run.result)
      const passed = checks.filter((check) => check.ok).length
      const fabricatedQuotes = fabricatedQuoteCount(evalCase, run.result)
      summary.checksTotal += checks.length
      summary.checksPassed += passed
      summary.fabricatedQuotes += fabricatedQuotes
      const failures = checks
        .filter((check) => !check.ok)
        .map((check) => `${check.field}[got=${check.got} want=${check.want}]`)
      const mark = failures.length === 0 ? "✓" : "✗"
      const fabricated = fabricatedQuotes > 0 ? ` fabricated_quotes=${fabricatedQuotes}` : ""
      console.log(
        `  ${mark} ${evalCase.name.padEnd(38)} ${passed}/${checks.length} ${run.latencyMs}ms${fabricated}${failures.length > 0 ? `  ${failures.join(" ")}` : ""}`,
      )
      runs.push({
        case: evalCase.name,
        latencyMs: run.latencyMs,
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        fabricatedQuotes,
        result: run.result,
        checks,
      })
    }

    const modelReport = reportModels[model]
    if (modelReport !== undefined) {
      modelReport.summary = {
        checksPassed: summary.checksPassed,
        checksTotal: summary.checksTotal,
        apiErrors: summary.apiErrors,
        parseFailures: summary.parseFailures,
        fabricatedQuotes: summary.fabricatedQuotes,
      }
    }
    summaries.push(summary)
    console.log("")
  }

  console.log("═══ SUMMARY ═══\n")
  for (const summary of summaries) {
    const accuracy = summary.checksTotal === 0
      ? "n/a"
      : `${summary.checksPassed}/${summary.checksTotal} (${Math.round((100 * summary.checksPassed) / summary.checksTotal)}%)`
    const parseOk = summary.cases - summary.apiErrors - summary.parseFailures
    const averageLatency = Math.round(summary.totalLatencyMs / summary.cases)
    console.log(
      `${summary.model}: ${accuracy}; parse ${parseOk}/${summary.cases}; API errors ${summary.apiErrors}; fabricated quotes ${summary.fabricatedQuotes}; avg ${averageLatency}ms; tokens ${summary.totalPromptTokens}/${summary.totalCompletionTokens}`,
    )
  }

  const outputDirectory = resolve(ROOT, "scripts/eval-output")
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = resolve(outputDirectory, "gota-check-eval.json")
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        cases: GOTA_EVAL_CASES.map((evalCase) => ({ name: evalCase.name, expect: evalCase.expect })),
        models: reportModels,
      },
      null,
      2,
    ),
  )
  console.log(`\nFull report written to ${outputPath}\n`)

  const failed = summaries.some(
    (summary) =>
      summary.apiErrors > 0 ||
      summary.parseFailures > 0 ||
      summary.checksPassed < summary.checksTotal ||
      summary.fabricatedQuotes > 0,
  )
  process.exit(failed ? 1 : 0)
}

main().catch((cause: unknown) => {
  console.error(cause)
  process.exit(1)
})
