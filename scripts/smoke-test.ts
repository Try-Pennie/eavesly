import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.test from project root
config({ path: resolve(__dirname, "..", ".env.test") })

const API_KEY = process.env.EAVESLY_API_KEY
const BASE_URL = process.env.EAVESLY_BASE_URL
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!API_KEY || !BASE_URL) {
  console.error("Missing EAVESLY_API_KEY or EAVESLY_BASE_URL in .env.test")
  process.exit(1)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.test")
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Fetch a random recent call from Supabase
// ---------------------------------------------------------------------------
interface CallRow {
  call_id: string
  agent_email: string
  contact_phone: string | null
  campaign_name: string | null
  disposition: string | null
  talk_time: number | null
  sfdc_lead_id: string | null
  full_transcript: string
  duration_seconds: number | null
  summary: string | null
}

async function fetchRandomCall(): Promise<CallRow> {
  // Step 1: Get transcriptions with transcript > 500 chars
  const { data: transcriptions, error: tError } = await supabase
    .from("eavesly_transcriptions")
    .select("call_id, full_transcript, duration_seconds, summary")
    .not("full_transcript", "is", null)
    .limit(100)

  if (tError || !transcriptions || transcriptions.length === 0) {
    throw new Error(
      `Failed to fetch transcriptions: ${tError?.message ?? "no rows returned"}`,
    )
  }

  // Filter for transcripts > 500 chars
  const eligible = transcriptions.filter(
    (r) => typeof r.full_transcript === "string" && r.full_transcript.length > 500,
  )

  if (eligible.length === 0) {
    throw new Error("No eligible transcriptions found with > 500 chars")
  }

  // Shuffle and try to find one with a matching call record that has agent_email
  const shuffled = eligible.sort(() => Math.random() - 0.5)

  for (const t of shuffled) {
    const { data: callData, error: cError } = await supabase
      .from("eavesly_calls")
      .select("call_id, agent_email, contact_phone, campaign_name, disposition, talk_time, sfdc_lead_id")
      .eq("call_id", t.call_id)
      .not("agent_email", "is", null)
      .limit(1)
      .single()

    if (cError || !callData) continue

    return {
      call_id: callData.call_id as string,
      agent_email: callData.agent_email as string,
      contact_phone: (callData.contact_phone as string) ?? null,
      campaign_name: (callData.campaign_name as string) ?? null,
      disposition: (callData.disposition as string) ?? null,
      talk_time: (callData.talk_time as number) ?? null,
      sfdc_lead_id: (callData.sfdc_lead_id as string) ?? null,
      full_transcript: t.full_transcript as string,
      duration_seconds: (t.duration_seconds as number) ?? null,
      summary: (t.summary as string) ?? null,
    }
  }

  throw new Error("No eligible calls found with both a transcript and agent_email")
}

// ---------------------------------------------------------------------------
// Build payload from DB row
// ---------------------------------------------------------------------------
function buildPayload(row: CallRow) {
  return {
    call_id: `SMOKE_${row.call_id}`,
    agent_id: row.agent_email,
    agent_email: row.agent_email,
    contact_phone: row.contact_phone ?? "+10000000000",
    recording_link: "https://smoke-test.invalid/recording.mp3",
    call_summary: row.summary ?? "Smoke test call — no summary available",
    transcript_url: "https://smoke-test.invalid/transcript",
    sfdc_lead_id: row.sfdc_lead_id ?? "00Q000000000000",
    transcript: {
      transcript: row.full_transcript,
      metadata: {
        duration: row.duration_seconds ?? 0,
        timestamp: new Date().toISOString(),
        talk_time: row.talk_time ?? 0,
        disposition: row.disposition ?? "unknown",
        campaign_name: row.campaign_name ?? "unknown",
      },
    },
  }
}

// ---------------------------------------------------------------------------
// DB verification — check eavesly_module_results after workflow completes
// ---------------------------------------------------------------------------
const MODULE_NAME_MAP: Record<string, string> = {
  "budget-inputs": "budget_inputs",
  "full-qa": "full_qa",
  "warm-transfer": "warm_transfer",
  "litigation-check": "litigation_check",
}

async function verifyDbResult(
  callId: string,
  endpointModule: string,
): Promise<boolean> {
  const moduleName = MODULE_NAME_MAP[endpointModule]
  if (!moduleName) return false

  const { data, error } = await supabase
    .from("eavesly_module_results")
    .select("call_id, module_name, has_violation, violation_type, processing_time_ms, result_json")
    .eq("call_id", callId)
    .eq("module_name", moduleName)
    .order("created_at", { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return false

  const row = data[0]
  return (
    row.call_id === callId &&
    row.module_name === moduleName &&
    typeof row.has_violation === "boolean" &&
    typeof row.processing_time_ms === "number" &&
    row.processing_time_ms > 0 &&
    row.result_json != null
  )
}

// ---------------------------------------------------------------------------
// Cleanup — remove smoke test results from DB
// ---------------------------------------------------------------------------
async function cleanupDbResults(callId: string): Promise<void> {
  const moduleNames = Object.values(MODULE_NAME_MAP)

  const { error } = await supabase
    .from("eavesly_module_results")
    .delete()
    .eq("call_id", callId)
    .in("module_name", moduleNames)

  if (error) {
    console.log(`${RED}Warning: cleanup failed — ${error.message}${RESET}`)
  } else {
    console.log(`${DIM}Cleaned up smoke test results for ${callId}${RESET}`)
  }
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------
interface TestResult {
  name: string
  passed: boolean
  timeMs: number
  violation?: string
  error?: string
  dbVerified?: boolean
}

const MODULES = ["budget-inputs", "full-qa", "warm-transfer", "litigation-check"] as const

async function runTest(
  name: string,
  fn: () => Promise<{ violation?: string; dbVerified?: boolean }>,
): Promise<TestResult> {
  const start = Date.now()
  try {
    const { violation, dbVerified } = await fn()
    return { name, passed: true, timeMs: Date.now() - start, violation, dbVerified }
  } catch (err) {
    return {
      name,
      passed: false,
      timeMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function testHealthRoot(): Promise<{ violation?: string }> {
  const res = await fetch(`${BASE_URL}/`)
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  if (body.service !== "eavesly") throw new Error(`Unexpected service: ${body.service}`)
  if (body.status !== "ok") throw new Error(`Unexpected status: ${body.status}`)
  return {}
}

async function testHealthCheck(): Promise<{ violation?: string }> {
  const res = await fetch(`${BASE_URL}/health`)
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  if (body.status !== "healthy") throw new Error(`Unexpected status: ${body.status}`)
  if (!(body.checks as Record<string, unknown>)?.database)
    throw new Error("Missing checks.database")
  return {}
}

const POLL_INTERVAL_MS = 5_000
const POLL_MAX_MS = 90_000

async function pollWorkflowStatus(
  instanceId: string,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < POLL_MAX_MS) {
    const res = await fetch(`${BASE_URL}/api/v1/status/${instanceId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    if (!res.ok) {
      throw new Error(`Status poll failed: ${res.status}`)
    }
    const body = (await res.json()) as Record<string, unknown>
    const status = body.status as string

    if (status === "complete") return body
    if (status === "errored") throw new Error(`Workflow errored: ${body.error ?? "unknown"}`)

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Workflow did not complete within ${POLL_MAX_MS / 1000}s`)
}

async function testModule(
  module: string,
  callPayload: Record<string, unknown>,
): Promise<{ violation?: string; dbVerified?: boolean }> {
  const res = await fetch(`${BASE_URL}/api/v1/evaluate/${module}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(callPayload),
  })

  let output: Record<string, unknown> | undefined

  if (res.status === 202) {
    // Async workflow — poll for completion
    const body = (await res.json()) as Record<string, unknown>
    if (!body.workflow_instance_id)
      throw new Error("Missing workflow_instance_id in 202 response")

    const result = await pollWorkflowStatus(body.workflow_instance_id as string)
    output = result.output as Record<string, unknown> | undefined
  } else if (res.status === 200) {
    // Synchronous response — result is inline
    output = (await res.json()) as Record<string, unknown>
  } else {
    const text = await res.text()
    throw new Error(`Expected 200 or 202, got ${res.status}: ${text.slice(0, 200)}`)
  }

  const violation = output?.has_violation
    ? (output.violation_type as string) ?? "yes"
    : undefined

  // Verify DB result
  const dbVerified = await verifyDbResult(callPayload.call_id as string, module)

  return { violation, dbVerified }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
const RESET = "\x1b[0m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const DIM = "\x1b[2m"

function printSummary(results: TestResult[]) {
  const nameW = 28
  const statusW = 8
  const timeW = 10
  const violW = 20
  const dbW = 4

  const hr = `${"─".repeat(nameW)}┼${"─".repeat(statusW)}┼${"─".repeat(timeW)}┼${"─".repeat(violW)}┼${"─".repeat(dbW)}`
  const header = `${CYAN}${"Endpoint".padEnd(nameW)}│${"Status".padEnd(statusW)}│${"Time(ms)".padEnd(timeW)}│${"Violation".padEnd(violW)}│${"DB".padEnd(dbW)}${RESET}`

  console.log()
  console.log(header)
  console.log(hr)

  for (const r of results) {
    const status = r.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    const time = String(r.timeMs)
    const viol = r.violation ?? (r.error ? `${RED}err${RESET}` : `${DIM}-${RESET}`)
    // Pad accounting for ANSI escape sequences
    const statusPad = status + " ".repeat(statusW - 4)
    const violPad = r.violation
      ? r.violation.padEnd(violW)
      : viol + " ".repeat(Math.max(0, violW - (r.error ? 3 : 1)))

    let dbCol: string
    if (r.dbVerified === undefined) {
      dbCol = `${DIM}-${RESET}` + " ".repeat(dbW - 1)
    } else if (r.dbVerified) {
      dbCol = `${GREEN}✓${RESET}` + " ".repeat(dbW - 1)
    } else {
      dbCol = `${RED}✗${RESET}` + " ".repeat(dbW - 1)
    }

    console.log(
      `${r.name.padEnd(nameW)}│${statusPad}│${time.padEnd(timeW)}│${violPad}│${dbCol}`,
    )
  }

  console.log(hr)

  if (results.some((r) => !r.passed)) {
    console.log()
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`${RED}FAIL${RESET} ${r.name}: ${r.error}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nSmoke testing ${CYAN}${BASE_URL}${RESET}\n`)

  // Fetch a random call from Supabase
  console.log("Fetching random call from Supabase...")
  const callRow = await fetchRandomCall()
  const callPayload = buildPayload(callRow)
  console.log(`Selected call: ${CYAN}${callRow.call_id}${RESET}`)
  console.log(
    `  agent: ${callRow.agent_email}, transcript length: ${callRow.full_transcript.length} chars\n`,
  )

  const results: TestResult[] = []

  // 1. Health checks (run in parallel)
  const [root, health] = await Promise.all([
    runTest("GET /", testHealthRoot),
    runTest("GET /health", testHealthCheck),
  ])
  results.push(root, health)

  // 2. Module evaluations (run sequentially to avoid rate limits)
  for (const mod of MODULES) {
    const result = await runTest(mod, () => testModule(mod, callPayload))
    results.push(result)
  }

  printSummary(results)

  const allPassed = results.every((r) => r.passed)
  const allDbVerified = results
    .filter((r) => r.dbVerified !== undefined)
    .every((r) => r.dbVerified)

  console.log(
    allPassed
      ? `\n${GREEN}All ${results.length} checks passed.${RESET}`
      : `\n${RED}${results.filter((r) => !r.passed).length} of ${results.length} checks failed.${RESET}`,
  )

  if (!allDbVerified) {
    console.log(`${RED}Some DB verifications failed.${RESET}`)
  }

  // Cleanup smoke test results from DB
  console.log()
  await cleanupDbResults(callPayload.call_id)

  console.log()
  process.exit(allPassed ? 0 : 1)
}

main()
