import type { AppEnv } from "../types/env"
import type { DatabaseService } from "./database"
import {
  buildModuleTriggerPlan,
  transcriptEventToCallData,
  DEFAULT_RESOLVER_POLICY,
} from "./regal-events"
import type { EvaluateRequest } from "../schemas/requests"
import { log } from "../utils/logger"

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
 * `${call_id}-${moduleName}` workflow instance id. All results are name/id/count
 * only — never transcript, contact, or payload data.
 */

/** Per-module launch status. Names + status only (no PII). */
export type ActiveTrigger = { module: string; status: "queued" | "skipped" | "error" }

/**
 * Launch one module's EVALUATION_WORKFLOW. Idempotent via the deterministic
 * instance id: an "already exists" error is treated as skipped, other errors are
 * logged and reported but never fail the caller.
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

  // Live: process at most `limit` tasks. For each, rebuild callData + plan from
  // the stored events (internal only) and launch just the still-missing
  // triggered modules. launchModule dedupes via the deterministic instance id.
  const batch = candidates.slice(0, limit)
  let launched = 0
  let skipped_existing_result = 0
  let skipped_existing_workflow = 0
  let errors = 0

  for (const cand of batch) {
    try {
      const joined = await db.getRegalCallEvents(cand.regal_task_id)
      if (!joined.transcript) {
        // Can't build callData without a transcript event — count and move on.
        errors++
        continue
      }
      const callData = transcriptEventToCallData(joined.transcript, joined.completed)
      const plan = buildModuleTriggerPlan(joined, DEFAULT_RESOLVER_POLICY)

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
    processed_tasks: batch.length,
    launched,
    skipped_existing_result,
    skipped_existing_workflow,
    errors,
    remaining_estimate: Math.max(0, candidates.length - batch.length),
    sample: sampleOf(batch),
    duplicate_audit,
  }
}
