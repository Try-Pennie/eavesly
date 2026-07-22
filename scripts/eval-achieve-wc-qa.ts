/**
 * Achieve welcome-call QA eval harness.
 *
 * Regression check for prompt/model changes to the achieve-welcome-call-qa
 * module. Each labeled case runs through the REAL production pipeline:
 *
 *   1. segmentWelcomeCall() — the deterministic boundary logic. Segmentation
 *      expectations (segment_found / skip_reason) are asserted first, with no
 *      LLM call; a skip case that unexpectedly grades (or vice versa) fails.
 *   2. For gradeable segments: the production system prompt + preamble +
 *      buildUserPrompt(), scored against the labeled `expect.grading` fields.
 *
 * Run this before merging changes to prompts/achieve-welcome-call-qa.txt,
 * the segmenter, or the module's violation rules.
 *
 * Usage:
 *   npm run eval:achieve-wc                        # production model (openai/gpt-4.1)
 *   npm run eval:achieve-wc -- openai/gpt-4.1 deepseek/deepseek-chat
 *
 * Requires CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN in .dev.vars or .env.test.
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import type { z } from "zod"
import { AchieveWelcomeCallQASchema } from "../src/schemas/achieve-welcome-call-qa"
import { buildUserPrompt } from "../src/modules/types"
import {
  segmentWelcomeCall,
  type WelcomeCallSegment,
} from "../src/modules/achieve-welcome-call-qa/segment"
import { EVAL_CASES, type EvalCase } from "./eval-cases/achieve-welcome-call-qa-cases"

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

// Default to the production model (wrangler.toml OPENROUTER_MODEL) so the
// default run answers "did my prompt change regress production behavior?".
const DEFAULT_MODELS = ["openai/gpt-4.1"]
const MODELS = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const models = MODELS.length ? MODELS : DEFAULT_MODELS

const SYSTEM_PROMPT = readFileSync(
  resolve(ROOT, "prompts/achieve-welcome-call-qa.txt"),
  "utf8",
)

// ── Mirrors of src/modules/achieve-welcome-call-qa/module.ts ────────────────
// module.ts can't be imported here (it imports the .txt prompt, which only the
// Workers build resolves), so the preamble and EvalSchema are kept in sync
// manually — same approach as eval-disposition-models.ts.

const EvalSchema = AchieveWelcomeCallQASchema.extend({
  partner_id: AchieveWelcomeCallQASchema.shape.partner_id.optional(),
  script_version: AchieveWelcomeCallQASchema.shape.script_version.optional(),
  agent_identity_check: AchieveWelcomeCallQASchema.shape.agent_identity_check.optional(),
  transfer_experience: AchieveWelcomeCallQASchema.shape.transfer_experience.optional(),
  transcript_segment: AchieveWelcomeCallQASchema.shape.transcript_segment.optional(),
})
type Analysis = z.infer<typeof EvalSchema>

function preamble(seg: WelcomeCallSegment): string {
  return [
    "You are grading ONLY the bounded live Achieve/FDR welcome-call interaction below.",
    "Automated menu/disclosure audio and transfer-partner content before or after this interaction are intentionally excluded.",
    "Do NOT give credit for, and do NOT infer required elements from, content outside this segment.",
    `Segment located via marker "${seg.marker}" (segmentation confidence: ${seg.segmentation_confidence}).`,
    "",
    "Please evaluate the following Achieve/FDR segment for script adherence:",
  ].join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────

const client = new OpenAI({
  apiKey: CF_AIG_TOKEN,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openrouter`,
  defaultHeaders: {
    "HTTP-Referer": "https://trypennie.com",
    "X-Title": "Pennie Call QA System",
  },
})

interface RunResult {
  latencyMs: number
  promptTokens: number
  completionTokens: number
  analysis: Analysis | null
  parseError: string | null
  error: string | null
}

async function runOne(model: string, seg: WelcomeCallSegment): Promise<RunResult> {
  const userPrompt = buildUserPrompt(preamble(seg), seg.segment)
  const t0 = Date.now()
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(EvalSchema, "achieve_welcome_call_qa_evaluation"),
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
    const r = EvalSchema.safeParse(parsed)
    if (!r.success) {
      const detail = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      return { latencyMs, promptTokens, completionTokens, analysis: null, parseError: `schema: ${detail}`, error: null }
    }
    return { latencyMs, promptTokens, completionTokens, analysis: r.data, parseError: null, error: null }
  } catch (e) {
    return { latencyMs: Date.now() - t0, promptTokens: 0, completionTokens: 0, analysis: null, parseError: null, error: (e as Error).message }
  }
}

interface Check {
  field: string
  ok: boolean
  got: string
  want: string
}

function scoreCase(c: EvalCase, analysis: Analysis): Check[] {
  const checks: Check[] = []
  const g = c.expect.grading
  if (!g) return checks

  if (g.elements) {
    for (const [key, want] of Object.entries(g.elements)) {
      const got = analysis.script_adherence[key as keyof typeof analysis.script_adherence]
      checks.push({ field: key, ok: got === want, got: String(got), want: String(want) })
    }
  }
  if (g.violation !== undefined) {
    checks.push({
      field: "violation",
      ok: analysis.script_adherence.violation === g.violation,
      got: String(analysis.script_adherence.violation),
      want: String(g.violation),
    })
  }
  if (g.overall_in !== undefined) {
    const got = analysis.script_adherence.overall_script_adherence
    checks.push({ field: "overall", ok: g.overall_in.includes(got), got, want: g.overall_in.join("|") })
  }
  if (g.correctly_identified_as_fdr !== undefined) {
    const got = analysis.agent_identity_check?.correctly_identified_as_fdr
    checks.push({
      field: "fdr_identity",
      ok: got === g.correctly_identified_as_fdr,
      got: String(got),
      want: String(g.correctly_identified_as_fdr),
    })
  }

  return checks
}

/** Count evidence quotes production's verbatim filter would drop. */
function fabricatedQuoteCount(analysis: Analysis, seg: WelcomeCallSegment): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const segNorm = normalize(seg.segment)
  return analysis.script_adherence.key_evidence_quotes.filter((q) => {
    const n = normalize(q)
    return n.length === 0 || !segNorm.includes(n)
  }).length
}

interface ModelSummary {
  model: string
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

async function main() {
  // ── Phase 1: deterministic segmentation assertions (no LLM) ───────────────
  console.log(`\nAchieve welcome-call QA eval — ${EVAL_CASES.length} cases × ${models.length} model(s)`)
  console.log(`Models: ${models.join(", ")}\n`)
  console.log("━━━ Segmentation (deterministic) ━━━")

  const segments = new Map<string, WelcomeCallSegment>()
  let segFailures = 0
  for (const c of EVAL_CASES) {
    const seg = segmentWelcomeCall(c.transcript)
    segments.set(c.name, seg)
    const e = c.expect.segment
    if (!e) continue
    const okFound = seg.segment_found === e.segment_found
    const okReason = e.skip_reason === undefined || seg.skip_reason === e.skip_reason
    const ok = okFound && okReason
    if (!ok) segFailures++
    const detail = seg.segment_found
      ? `segment lines ${seg.start_line}-${seg.end_line}`
      : `skip_reason=${seg.skip_reason}`
    console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(38)} ${detail}${ok ? "" : `  (want segment_found=${e.segment_found}${e.skip_reason ? ` skip_reason=${e.skip_reason}` : ""})`}`)
  }
  if (segFailures > 0) {
    console.error(`\n${segFailures} segmentation assertion(s) failed — fix segmentation before grading.\n`)
    process.exit(1)
  }

  const gradedCases = EVAL_CASES.filter((c) => {
    const seg = segments.get(c.name)!
    if (!c.expect.grading) return false
    if (!seg.segment_found) {
      console.error(`  ! ${c.name} has grading expectations but no segment was found — skipping.`)
      return false
    }
    return true
  })

  // ── Phase 2: LLM grading ──────────────────────────────────────────────────
  const summaries: ModelSummary[] = []
  const report: any = {
    models: {},
    cases: EVAL_CASES.map((c) => ({ name: c.name, expect: c.expect })),
  }

  for (const model of models) {
    console.log(`\n━━━ ${model} ━━━`)
    const s: ModelSummary = {
      model, cases: gradedCases.length, apiErrors: 0, parseFailures: 0,
      checksTotal: 0, checksPassed: 0, fabricatedQuotes: 0,
      totalLatencyMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
    }
    report.models[model] = { runs: [] }

    for (const c of gradedCases) {
      const seg = segments.get(c.name)!
      const res = await runOne(model, seg)
      s.totalLatencyMs += res.latencyMs
      s.totalPromptTokens += res.promptTokens
      s.totalCompletionTokens += res.completionTokens

      if (res.error) {
        s.apiErrors++
        console.log(`  ✗ ${c.name.padEnd(38)} API ERROR: ${res.error.slice(0, 80)}`)
        report.models[model].runs.push({ case: c.name, error: res.error })
        continue
      }
      if (!res.analysis) {
        s.parseFailures++
        console.log(`  ✗ ${c.name.padEnd(38)} PARSE FAIL: ${res.parseError}`)
        report.models[model].runs.push({ case: c.name, parseError: res.parseError })
        continue
      }
      const checks = scoreCase(c, res.analysis)
      const fabricated = fabricatedQuoteCount(res.analysis, seg)
      s.fabricatedQuotes += fabricated
      const passed = checks.filter((ck) => ck.ok).length
      s.checksTotal += checks.length
      s.checksPassed += passed
      const mark = passed === checks.length ? "✓" : "✗"
      const failBits = checks.filter((ck) => !ck.ok).map((ck) => `${ck.field}[got=${ck.got} want=${ck.want}]`)
      const fabBit = fabricated > 0 ? `  fabricated_quotes=${fabricated}` : ""
      console.log(`  ${mark} ${c.name.padEnd(38)} ${passed}/${checks.length} ${res.latencyMs}ms${fabBit}${failBits.length ? "  " + failBits.join(" ") : ""}`)
      report.models[model].runs.push({
        case: c.name, latencyMs: res.latencyMs,
        promptTokens: res.promptTokens, completionTokens: res.completionTokens,
        fabricatedQuotes: fabricated, analysis: res.analysis, checks,
      })
    }
    summaries.push(s)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n\n═══ SUMMARY ═══\n")
  const header = ["model", "accuracy", "parse", "apiErr", "fabQuotes", "avgLatency", "tokens(in/out)"]
  const rows = summaries.map((s) => {
    const acc = s.checksTotal ? `${s.checksPassed}/${s.checksTotal} (${Math.round((100 * s.checksPassed) / s.checksTotal)}%)` : "n/a"
    const parse = `${s.cases - s.parseFailures - s.apiErrors}/${s.cases} ok`
    const avgLat = s.cases ? `${Math.round(s.totalLatencyMs / s.cases)}ms` : "n/a"
    const toks = `${s.totalPromptTokens}/${s.totalCompletionTokens}`
    report.models[s.model].summary = {
      accuracy: acc, parseOk: parse, apiErrors: s.apiErrors, fabricatedQuotes: s.fabricatedQuotes,
      avgLatencyMs: s.cases ? Math.round(s.totalLatencyMs / s.cases) : null,
      promptTokens: s.totalPromptTokens, completionTokens: s.totalCompletionTokens,
    }
    return [s.model, acc, parse, String(s.apiErrors), String(s.fabricatedQuotes), avgLat, toks]
  })
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log(fmt(header))
  console.log(widths.map((w) => "─".repeat(w)).join("  "))
  rows.forEach((r) => console.log(fmt(r)))

  const outDir = resolve(ROOT, "scripts/eval-output")
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, "achieve-wc-qa-eval.json")
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\nFull report written to ${outPath}\n`)

  const anyFailure = summaries.some(
    (s) => s.apiErrors > 0 || s.parseFailures > 0 || s.checksPassed < s.checksTotal,
  )
  process.exit(anyFailure ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
