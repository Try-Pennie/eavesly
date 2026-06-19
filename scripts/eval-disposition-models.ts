/**
 * Disposition-review model eval harness.
 *
 * Runs each candidate model through the REAL disposition-review system prompt,
 * user-prompt builder, and analysis schema (the same call the production module
 * makes), then pushes the result through buildDispositionReview() so we score the
 * production contract — recommended_action, permission — not just raw LLM text.
 *
 * Purpose: decide whether a cheaper open-weight model can replace openai/gpt-4.1
 * for this advisory module. Reports per-model accuracy on the labeled fixtures
 * plus latency, token usage, and estimated cost.
 *
 * Usage:
 *   npm run eval:disposition                       # gpt-4.1 vs deepseek/deepseek-chat
 *   npm run eval:disposition -- openai/gpt-4.1 deepseek/deepseek-chat qwen/qwen-2.5-72b-instruct
 *
 * Requires CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN in .dev.vars or .env.test.
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import {
  DispositionAnalysisSchema,
  type DispositionAnalysis,
} from "../src/schemas/disposition-review"
import { buildUserPrompt } from "../src/modules/types"
import { buildDispositionReview } from "../src/modules/disposition-review/logic"
import { EVAL_CASES, type EvalCase } from "./eval-cases/disposition-review-cases"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

// Load secrets (later calls don't override already-set vars, so .dev.vars wins).
config({ path: resolve(ROOT, ".dev.vars") })
config({ path: resolve(ROOT, ".env.test") })

const { CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN } = process.env
if (!CF_ACCOUNT_ID || !CF_GATEWAY_ID || !CF_AIG_TOKEN) {
  console.error(
    "Missing CF_ACCOUNT_ID / CF_GATEWAY_ID / CF_AIG_TOKEN. Add them to .dev.vars or .env.test.",
  )
  process.exit(1)
}

const DEFAULT_MODELS = ["openai/gpt-4.1", "deepseek/deepseek-chat"]
const MODELS = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const models = MODELS.length ? MODELS : DEFAULT_MODELS

// Approximate OpenRouter prices, USD per 1M tokens (input/output). These move —
// verify on https://openrouter.ai/models. Cost is reported as an estimate and
// omitted for any model missing here.
const PRICES: Record<string, { in: number; out: number }> = {
  "openai/gpt-4.1": { in: 2.0, out: 8.0 },
  "deepseek/deepseek-chat": { in: 0.28, out: 0.88 },
  "meta-llama/llama-3.3-70b-instruct": { in: 0.12, out: 0.3 },
  "qwen/qwen-2.5-72b-instruct": { in: 0.12, out: 0.39 },
  "mistralai/mistral-small": { in: 0.2, out: 0.6 },
}

const SYSTEM_PROMPT = readFileSync(
  resolve(ROOT, "prompts/disposition-review.txt"),
  "utf8",
)

// Mirrors the base prompt in src/modules/disposition-review/module.ts. Kept in
// sync manually; module.ts can't be imported here (it imports the .txt prompt,
// which only the Workers build resolves).
function basePrompt(currentDisposition: string | null): string {
  return (
    `The CRM currently has this call dispositioned as: "${currentDisposition ?? "(none / unknown)"}".\n\n` +
    "Review the following call transcript and determine whether that disposition accurately reflects what happened. " +
    "Suggest the most accurate disposition from the taxonomy in your instructions, cite evidence, and assess your confidence:"
  )
}

const client = new OpenAI({
  apiKey: CF_AIG_TOKEN,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openrouter`,
  defaultHeaders: {
    "HTTP-Referer": "https://trypennie.com",
    "X-Title": "Pennie Call QA System",
  },
})

function transcriptFor(c: EvalCase): string {
  if (c.transcriptFile) {
    return readFileSync(resolve(ROOT, c.transcriptFile), "utf8")
  }
  return c.transcript ?? ""
}

interface RunResult {
  latencyMs: number
  promptTokens: number
  completionTokens: number
  analysis: DispositionAnalysis | null
  parseError: string | null
  error: string | null
}

async function runOne(model: string, c: EvalCase): Promise<RunResult> {
  const userPrompt = buildUserPrompt(
    basePrompt(c.currentDisposition),
    transcriptFor(c),
  )
  const t0 = Date.now()
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(
        DispositionAnalysisSchema,
        "disposition_review_evaluation",
      ),
      temperature: 0.3,
    })
    const latencyMs = Date.now() - t0
    const content = resp.choices[0]?.message?.content
    const promptTokens = resp.usage?.prompt_tokens ?? 0
    const completionTokens = resp.usage?.completion_tokens ?? 0

    if (!content) {
      return { latencyMs, promptTokens, completionTokens, analysis: null, parseError: "empty response", error: null }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      return { latencyMs, promptTokens, completionTokens, analysis: null, parseError: `invalid json: ${(e as Error).message}`, error: null }
    }
    const r = DispositionAnalysisSchema.safeParse(parsed)
    if (!r.success) {
      const detail = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      return { latencyMs, promptTokens, completionTokens, analysis: null, parseError: `schema: ${detail}`, error: null }
    }
    return { latencyMs, promptTokens, completionTokens, analysis: r.data, parseError: null, error: null }
  } catch (e) {
    return { latencyMs: Date.now() - t0, promptTokens: 0, completionTokens: 0, analysis: null, parseError: null, error: (e as Error).message }
  }
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase()

interface Check {
  field: string
  ok: boolean
  got: string
  want: string
}

function scoreCase(c: EvalCase, analysis: DispositionAnalysis): Check[] {
  const review = buildDispositionReview(analysis, c.currentDisposition)
  const checks: Check[] = []
  const e = c.expect
  if (e.conversation_happened !== undefined) {
    checks.push({ field: "conversation", ok: analysis.conversation_happened === e.conversation_happened, got: analysis.conversation_happened, want: e.conversation_happened })
  }
  if (e.disposition_matches_transcript !== undefined) {
    checks.push({ field: "matches", ok: analysis.disposition_matches_transcript === e.disposition_matches_transcript, got: String(analysis.disposition_matches_transcript), want: String(e.disposition_matches_transcript) })
  }
  if (e.suggested_disposition !== undefined) {
    checks.push({ field: "suggested", ok: norm(analysis.suggested_disposition) === norm(e.suggested_disposition), got: analysis.suggested_disposition ?? "null", want: e.suggested_disposition })
  }
  if (e.recommended_action !== undefined) {
    checks.push({ field: "action", ok: review.recommended_action === e.recommended_action, got: review.recommended_action, want: e.recommended_action })
  }
  return checks
}

interface ModelSummary {
  model: string
  cases: number
  apiErrors: number
  parseFailures: number
  checksTotal: number
  checksPassed: number
  totalLatencyMs: number
  totalPromptTokens: number
  totalCompletionTokens: number
}

async function main() {
  console.log(`\nDisposition-review model eval — ${EVAL_CASES.length} cases × ${models.length} models`)
  console.log(`Models: ${models.join(", ")}\n`)

  const summaries: ModelSummary[] = []
  const report: any = { models: {}, cases: EVAL_CASES.map((c) => ({ name: c.name, expect: c.expect })) }

  for (const model of models) {
    console.log(`\n━━━ ${model} ━━━`)
    const s: ModelSummary = {
      model, cases: EVAL_CASES.length, apiErrors: 0, parseFailures: 0,
      checksTotal: 0, checksPassed: 0, totalLatencyMs: 0,
      totalPromptTokens: 0, totalCompletionTokens: 0,
    }
    report.models[model] = { runs: [] }

    for (const c of EVAL_CASES) {
      const res = await runOne(model, c)
      s.totalLatencyMs += res.latencyMs
      s.totalPromptTokens += res.promptTokens
      s.totalCompletionTokens += res.completionTokens

      if (res.error) {
        s.apiErrors++
        console.log(`  ✗ ${c.name.padEnd(34)} API ERROR: ${res.error.slice(0, 80)}`)
        report.models[model].runs.push({ case: c.name, error: res.error })
        continue
      }
      if (!res.analysis) {
        s.parseFailures++
        console.log(`  ✗ ${c.name.padEnd(34)} PARSE FAIL: ${res.parseError}`)
        report.models[model].runs.push({ case: c.name, parseError: res.parseError })
        continue
      }
      const checks = scoreCase(c, res.analysis)
      const passed = checks.filter((ck) => ck.ok).length
      s.checksTotal += checks.length
      s.checksPassed += passed
      const mark = passed === checks.length ? "✓" : "✗"
      const failBits = checks.filter((ck) => !ck.ok).map((ck) => `${ck.field}[got=${ck.got} want=${ck.want}]`)
      console.log(`  ${mark} ${c.name.padEnd(34)} ${passed}/${checks.length} ${res.latencyMs}ms${failBits.length ? "  " + failBits.join(" ") : ""}`)
      report.models[model].runs.push({
        case: c.name, latencyMs: res.latencyMs,
        promptTokens: res.promptTokens, completionTokens: res.completionTokens,
        analysis: res.analysis, review: buildDispositionReview(res.analysis, c.currentDisposition),
        checks,
      })
    }
    summaries.push(s)
  }

  // Summary table
  console.log("\n\n═══ SUMMARY ═══\n")
  const header = ["model", "accuracy", "parse", "apiErr", "avgLatency", "tokens(in/out)", "est cost"]
  const rows = summaries.map((s) => {
    const acc = s.checksTotal ? `${s.checksPassed}/${s.checksTotal} (${Math.round((100 * s.checksPassed) / s.checksTotal)}%)` : "n/a"
    const parse = `${s.cases - s.parseFailures - s.apiErrors}/${s.cases} ok`
    const avgLat = `${Math.round(s.totalLatencyMs / s.cases)}ms`
    const toks = `${s.totalPromptTokens}/${s.totalCompletionTokens}`
    const p = PRICES[s.model]
    const cost = p ? `$${((s.totalPromptTokens * p.in + s.totalCompletionTokens * p.out) / 1e6).toFixed(5)}` : "n/a"
    report.models[s.model].summary = { accuracy: acc, parseOk: parse, apiErrors: s.apiErrors, avgLatencyMs: Math.round(s.totalLatencyMs / s.cases), promptTokens: s.totalPromptTokens, completionTokens: s.totalCompletionTokens, estCostUsd: cost }
    return [s.model, acc, parse, String(s.apiErrors), avgLat, toks, cost]
  })
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log(fmt(header))
  console.log(widths.map((w) => "─".repeat(w)).join("  "))
  rows.forEach((r) => console.log(fmt(r)))
  console.log("\n(cost is an estimate over the eval set only; verify per-token prices on openrouter.ai/models)\n")

  const outDir = resolve(ROOT, "scripts/eval-output")
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, "disposition-review-eval.json")
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`Full report written to ${outPath}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
