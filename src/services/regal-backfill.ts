import type { AppEnv } from "../types/env"
import type { DatabaseService } from "./database"
import {
  buildModuleTriggerPlan,
  transcriptEventToCallData,
} from "./regal-events"
import type { EvaluateRequest } from "../schemas/requests"
import { log } from "../utils/logger"
import { workflowRetentionForEnvironment } from "../workflows/workflow-retention"

/**
 * Shared backfill logic for the Regal missed-window incident (2026-07-01), when
 * events and resolver plans were recorded but EVALUATION_WORKFLOWs were never
 * launched.
 *
 * Used by both the authenticated admin route (dry-run/status/manual batch) and,
 * opportunistically, by the live authenticated Regal event endpoints to drain
 * the fixed window from normal traffic. Selects candidates whose triggered
 * modules still have no results, re-launches only the still-missing ones via the
 * same resolver plan + callData path, and dedupes on the deterministic
 * `${call_id}-${moduleName}` workflow instance id while that instance remains
 * inside its configured retention window. All results are name/id/count only —
 * never transcript, contact, or payload data.
 */

/** Per-module launch status. Names + status only (no PII). */
export type ActiveTrigger = { module: string; status: "queued" | "skipped" | "error" }

/**
 * Launch one module's EVALUATION_WORKFLOW. Idempotent within the configured
 * Workflow retention window via the deterministic instance id: an "already
 * exists" error is treated as skipped, other errors are logged and reported but
 * never fail the caller.
 */
export async function launchModule(
  env: AppEnv["Bindings"],
  moduleName: string,
  callData: EvaluateRequest,
  correlationId: string | undefined,
): Promise<ActiveTrigger> {
  const instanceId = `${callData.call_id}-${moduleName}`
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: instanceId,
      params: { moduleName, callData, correlationId },
      retention: workflowRetentionForEnvironment(env.ENVIRONMENT),
    })
    return { module: moduleName, status: "queued" }
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) {
      return { module: moduleName, status: "skipped" }
    }
    log("error", "Regal active trigger failed", {
      correlationId,
      moduleName,
      instanceId,
      error: e instanceof Error ? e.message : String(e),
    })
    return { module: moduleName, status: "error" }
  }
}

export type RegalBackfillArgs = {
  db: DatabaseService
  env: AppEnv["Bindings"]
  start: string
  end: string
  limit: number
  dryRun: boolean
  correlationId: string | undefined
}

export type RegalBackfillResult =
  | {
      dry_run: true
      candidates: number
      missing_module_counts: Record<string, number>
      sample: Array<{ regal_task_id: string; missing_modules: string[] }>
      duplicate_audit: Awaited<ReturnType<DatabaseService["getDuplicateAudit"]>>
    }
  | {
      dry_run: false
      processed_tasks: number
      launched: number
      skipped_existing_result: number
      skipped_existing_workflow: number
      skipped_unprocessable: number
      errors: number
      remaining_estimate: number
      sample: Array<{ regal_task_id: string; missing_modules: string[] }>
      duplicate_audit: Awaited<ReturnType<DatabaseService["getDuplicateAudit"]>>
    }

const sampleOf = (cands: Array<{ regal_task_id: string; missing_modules: string[] }>) =>
  cands.slice(0, 10).map((c) => ({ regal_task_id: c.regal_task_id, missing_modules: c.missing_modules }))

/**
 * Run one backfill batch over the given window. Non-PII result. When there are
 * no candidates (backlog drained), returns quickly with zeroed counts.
 */
export async function runRegalBackfillBatch(args: RegalBackfillArgs): Promise<RegalBackfillResult> {
  const { db, env, start, end, limit, dryRun, correlationId } = args
  const candidates = await db.getBackfillCandidates(start, end)

  const missing_module_counts: Record<string, number> = {}
  for (const cand of candidates) {
    for (const m of cand.missing_modules) {
      missing_module_counts[m] = (missing_module_counts[m] ?? 0) + 1
    }
  }

  const duplicate_audit = await db.getDuplicateAudit(candidates.map((c) => c.regal_task_id))

  if (dryRun) {
    return {
      dry_run: true,
      candidates: candidates.length,
      missing_module_counts,
      sample: sampleOf(candidates),
      duplicate_audit,
    }
  }

  // Live: process up to `limit` *processable* tasks. Candidate selection already
  // requires a stored transcript, but if one is unexpectedly missing (race with
  // event ingestion) count it as skipped_unprocessable and keep scanning so a
  // valid task behind it still drains — never getting stuck at the front.
  // One policy read per batch, reused for every candidate's plan (not per candidate).
  const { policy, policyVersion } = await db.getResolverPolicy()

  let launched = 0
  let skipped_existing_result = 0
  let skipped_existing_workflow = 0
  let skipped_unprocessable = 0
  let errors = 0
  let processed = 0
  let scanned = 0
  const processedSample: Array<{ regal_task_id: string; missing_modules: string[] }> = []

  for (const cand of candidates) {
    if (processed >= limit) break
    scanned++

    const joined = await db.getRegalCallEvents(cand.regal_task_id)
    if (!joined.transcript) {
      // Can't build callData without a transcript event — skip, don't consume the limit.
      skipped_unprocessable++
      continue
    }

    processed++
    processedSample.push({ regal_task_id: cand.regal_task_id, missing_modules: cand.missing_modules })
    try {
      const callData = transcriptEventToCallData(joined.transcript, joined.completed)
      const plan = buildModuleTriggerPlan(joined, policy, policyVersion)

      // Only launch modules the plan still triggers AND that are still missing.
      const toLaunch = plan.triggered.filter((m) => cand.missing_modules.includes(m))
      // Triggered modules that already have a result → reported as skipped, not launched.
      skipped_existing_result += plan.triggered.length - toLaunch.length

      for (const moduleName of toLaunch) {
        const t = await launchModule(env, moduleName, callData, correlationId)
        if (t.status === "queued") launched++
        else if (t.status === "skipped") skipped_existing_workflow++
        else errors++
      }
    } catch (e) {
      log("error", "Backfill task failed", {
        correlationId,
        regalTaskId: cand.regal_task_id,
        error: e instanceof Error ? e.message : String(e),
      })
      errors++
    }
  }

  return {
    dry_run: false,
    processed_tasks: processed,
    launched,
    skipped_existing_result,
    skipped_existing_workflow,
    skipped_unprocessable,
    errors,
    remaining_estimate: Math.max(0, candidates.length - scanned),
    sample: sampleOf(processedSample),
    duplicate_audit,
  }
}
