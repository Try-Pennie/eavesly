import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers"
import type { Bindings } from "../types/env"
import type { EvaluateRequest } from "../schemas/requests"
import { getModule } from "./module-registry"
import type { ModuleResult, Alert } from "../modules/types"
import { createLLMClient } from "../services/llm-client"
import { modelForModule } from "../services/model-selection"
import { transcribeRecording, needsTranscription } from "../services/transcription"
import { DatabaseService } from "../services/database"
import { processAlert, lookupManagerEmail } from "../services/alerts"
import { routePartnerFollowup, isAchieveWelcomeCallEligible, isAchieveGotaCheckEligible } from "./partner-routing"
import { MODULE_NAMES } from "../modules/constants"
import { log } from "../utils/logger"

type EvaluationParams = {
  moduleName: string
  callData: EvaluateRequest
  correlationId: string
  recording?: { url: string; source: "twilio" }
}

export class EvaluationWorkflow extends WorkflowEntrypoint<Bindings, EvaluationParams> {
  async run(event: WorkflowEvent<EvaluationParams>, step: WorkflowStep) {
    const { moduleName, callData, correlationId, recording } = event.payload
    const mod = getModule(moduleName)

    // Step 0a: Transcribe recording (Twilio path only). The Regal path already
    // supplies a transcript, so this is skipped there.
    if (needsTranscription(callData, recording)) {
      const transcribed = await step.do("transcribe-recording", {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      }, async () => {
        return await transcribeRecording(this.env, recording!.url)
      })

      callData.transcript = {
        transcript: transcribed.transcript,
        metadata: { ...callData.transcript.metadata, duration: transcribed.durationSec },
      }
    }

    // Step 0a2: Disposition-review only. The CRM disposition isn't on the Regal
    // event — it lives in eavesly_calls — so look it up by call_id and inject it
    // as the authoritative current disposition. Also backfills sfdc_lead_id so
    // the history step below can load prior-call context.
    // Who dispositioned the call decides which disposition vocabulary the model
    // suggests from: AI-agent (Zoe) calls come from @regal.ai, humans from elsewhere.
    let audience: "human" | "ai" = "human"
    if (moduleName === MODULE_NAMES.DISPOSITION_REVIEW) {
      const ctx = await step.do("fetch-call-disposition", {
        retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
        timeout: "30 seconds",
      }, async () => {
        const db = new DatabaseService(this.env)
        return await db.getCallContext(callData.call_id)
      })

      if (ctx) {
        callData.transcript.metadata = {
          ...callData.transcript.metadata,
          disposition: ctx.disposition ?? callData.transcript.metadata.disposition,
          // Backfill talk time from eavesly_calls so the model sees actual
          // conversation seconds, not just the Regal event's (often absent) value.
          talk_time: callData.transcript.metadata.talk_time ?? ctx.talk_time ?? undefined,
        }
        if (!callData.sfdc_lead_id && ctx.sfdc_lead_id) {
          callData.sfdc_lead_id = ctx.sfdc_lead_id
        }
        if (ctx.agent_email?.toLowerCase().endsWith("@regal.ai")) {
          audience = "ai"
        }
      }
    }

    // Step 0: Fetch prior call context (if sfdc_lead_id available)
    const callHistory = await step.do("fetch-call-history", {
      retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
      timeout: "30 seconds",
    }, async () => {
      if (!callData.sfdc_lead_id) return null
      const db = new DatabaseService(this.env)
      return await db.getPriorCallContext(callData.sfdc_lead_id, callData.call_id)
    })

    // Step 0c: Disposition-review only. Load the live CRM disposition catalog so
    // the suggestable taxonomy mirrors the Dispositions admin screen at eval time.
    const dispositions = moduleName === MODULE_NAMES.DISPOSITION_REVIEW
      ? await step.do("fetch-dispositions", {
          retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
          timeout: "30 seconds",
        }, async () => {
          const db = new DatabaseService(this.env)
          return await db.getActiveDispositions()
        })
      : []

    // Step 1: LLM evaluation (the expensive step)
    // step.do() constrains its callback return to Workflows' Serializable<T>, which
    // rejects our domain types; these values are plain JSON round-tripping, so cast
    // at the boundary and keep the logical type on the result.
    const result: ModuleResult = await step.do("evaluate-llm", {
      retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    }, async () => {
      const llm = createLLMClient(this.env, modelForModule(this.env, moduleName))
      return await mod.evaluate(callData.transcript.transcript, callData, llm, callHistory, dispositions, audience) as any
    })

    // Step 2: Store result in Supabase
    const alerts: Alert[] = await step.do("store-result", {
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "1 minute",
    }, async () => {
      const db = new DatabaseService(this.env)
      const alerts = mod.extractAlerts(result, callData.call_id, callData.agent_id, callData)
      await db.storeModuleResult(callData.call_id, result, alerts.length > 0, callData)
      return alerts as any
    })

    // Step 2c: Beyond partner routing (warm_transfer only). After the warm-transfer
    // eval is stored, deterministically chain budget_inputs when the completing
    // agent is resolved to Beyond in agent_regal_assignments. Best-effort: routing
    // must never fail the warm_transfer workflow.
    if (moduleName === MODULE_NAMES.WARM_TRANSFER) {
      try {
        await step.do(`route-${MODULE_NAMES.BUDGET_INPUTS}`, {
          retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
          timeout: "1 minute",
        }, async () => {
          const db = new DatabaseService(this.env)
          await routePartnerFollowup(this.env, db, callData, correlationId, {
            partner: "beyond",
            moduleName: MODULE_NAMES.BUDGET_INPUTS,
          })
        })
      } catch (err) {
        log("error", "Partner routing failed (non-fatal)", {
          callId: callData.call_id,
          partner: "beyond",
          module: MODULE_NAMES.BUDGET_INPUTS,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Step 2c2: Achieve welcome-call QA follow-up (disposition_review only).
    // disposition_review is the one module guaranteed to run exactly once with BOTH
    // the transcript and the completed event joined regardless of webhook arrival
    // order (63% of calls receive transcript_available before call_completed), and
    // step 0a2 above has already injected the authoritative CRM disposition into
    // callData. Chaining here (rather than off warm_transfer) also includes
    // legal-model clients (LegalState != "No"), whose welcome calls are just as
    // real — field review 2026-07-21. Gated by the enrollment disposition + a token
    // duration floor (cheap, DB-free) before the partner-assignment lookup.
    // Best-effort: routing must never fail the disposition_review workflow.
    if (moduleName === MODULE_NAMES.DISPOSITION_REVIEW && callData.transcript.metadata.disposition) {
      try {
        await step.do(`route-${MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA}`, {
          retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
          timeout: "1 minute",
        }, async () => {
          const db = new DatabaseService(this.env)
          const { policy } = await db.getResolverPolicy()
          await routePartnerFollowup(this.env, db, callData, correlationId, {
            partner: "achieve",
            moduleName: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
            eligibility: (cd: EvaluateRequest) => isAchieveWelcomeCallEligible(cd, policy),
          })
        })
      } catch (err) {
        log("error", "Partner routing failed (non-fatal)", {
          callId: callData.call_id,
          partner: "achieve",
          module: MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Step 2c3: Achieve combined PSC + GOTA follow-up (disposition_review only).
    // GOTA applies to every Achieve enrollment regardless of LegalState (red/
    // Turnbull legal-model states never reach warm_transfer), and
    // disposition_review is the one module guaranteed to run exactly once with
    // BOTH the transcript and completed event joined regardless of webhook
    // arrival order — and with lead_context (LegalState/clientState) carried on
    // callData for deterministic guide selection. It chains independently of the
    // achieve_welcome_call_qa follow-up above (distinct module name => distinct
    // workflow instance id, so idempotency is preserved). Gated by the enrollment
    // disposition + duration (cheap, DB-free) before the partner-assignment
    // lookup. Best-effort: routing must never fail the disposition_review workflow.
    if (moduleName === MODULE_NAMES.DISPOSITION_REVIEW && callData.transcript.metadata.disposition) {
      try {
        await step.do(`route-${MODULE_NAMES.GOTA_CHECK}`, {
          retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
          timeout: "1 minute",
        }, async () => {
          const db = new DatabaseService(this.env)
          const { policy } = await db.getResolverPolicy()
          await routePartnerFollowup(this.env, db, callData, correlationId, {
            partner: "achieve",
            moduleName: MODULE_NAMES.GOTA_CHECK,
            eligibility: (cd: EvaluateRequest) => isAchieveGotaCheckEligible(cd, policy),
          })
        })
      } catch (err) {
        log("error", "Partner routing failed (non-fatal)", {
          callId: callData.call_id,
          partner: "achieve",
          module: MODULE_NAMES.GOTA_CHECK,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Step 2b: Store QA result in legacy table (full_qa only)
    if (moduleName === MODULE_NAMES.FULL_QA) {
      await step.do("store-qa-result", {
        retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
        timeout: "1 minute",
      }, async () => {
        const db = new DatabaseService(this.env)
        const r = result as any
        const managerEmail = await lookupManagerEmail(this.env, callData.agent_email)
        await db.storeQAResult(callData, r.result, managerEmail)
      })
    }

    // Step 3: Dispatch alerts (Slack webhook) — best-effort, non-fatal
    if (alerts.length > 0) {
      await step.do("dispatch-alerts", {
        retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
        timeout: "1 minute",
      }, async () => {
        for (const alert of alerts) {
          try {
            await processAlert(alert, this.env)
          } catch (err) {
            log("error", "Alert dispatch failed (non-fatal)", {
              callId: callData.call_id,
              module: moduleName,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      })
    }

    // Step 4: Log completion
    await step.do("log-completion", {
      retries: { limit: 2, delay: "1 second", backoff: "constant" },
      timeout: "30 seconds",
    }, async () => {
      const db = new DatabaseService(this.env)
      await db.logRequest({
        endpoint: moduleName.replace(/_/g, "-"),
        callId: callData.call_id,
        status: "workflow_completed",
        statusCode: 200,
        correlationId,
      })
    })

    return {
      call_id: callData.call_id,
      module: moduleName,
      has_violation: result.has_violation,
      violation_type: result.violation_type,
      processing_time_ms: result.processing_time_ms,
    }
  }
}
