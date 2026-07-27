import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Bindings } from "../types/env"
import type { ModuleResult, CallHistoryContext, PriorCall, Disposition } from "../modules/types"
import { MODULE_NAMES } from "../modules/constants"
import type { EvaluateRequest } from "../schemas/requests"
import type { RegalCallEvent, JoinedRegalEvents, ModuleTriggerPlan, ActiveResolverPolicy } from "./regal-events"
import { DEFAULT_RESOLVER_POLICY, parseResolverPolicyRow, callCompletedEventToCallRow } from "./regal-events"
import type { CallCompletedEvent } from "../schemas/regal-events"
import { log } from "../utils/logger"
import { parseMonitoringSnapshot, type MonitoringSnapshot } from "./monitoring-health"

/** Identity and ordering data used to find calls that happened before an evaluation. */
export interface PriorCallLookup {
  readonly currentCallId: string
  readonly sfdcLeadId?: string
  readonly contactPhone?: string
  readonly currentStartedAt?: string
}

export class DatabaseService {
  private client: SupabaseClient

  constructor(env: Bindings, client?: SupabaseClient) {
    this.client = client ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  }

  async storeModuleResult(
    callId: string,
    result: ModuleResult,
    alertSent: boolean,
    callData?: EvaluateRequest,
  ): Promise<void> {
    const { error } = await this.client.from("eavesly_module_results").upsert(
      {
        call_id: callId,
        module_name: result.module_name,
        result_json: result.result,
        has_violation: result.has_violation,
        violation_type: result.violation_type,
        alert_sent: alertSent,
        alert_sent_at: alertSent ? new Date().toISOString() : null,
        processing_time_ms: result.processing_time_ms,
        agent_email: callData?.agent_email ?? null,
        contact_name: callData?.contact_name ?? null,
        contact_phone: callData?.contact_phone ?? null,
        recording_link: callData?.recording_link ?? null,
        call_summary: callData?.call_summary ?? null,
        transcript_url: callData?.transcript_url ?? null,
        sfdc_lead_id: callData?.sfdc_lead_id ?? null,
      },
      { onConflict: "call_id,module_name" },
    )

    if (error) {
      log("error", "Failed to store module result", {
        callId,
        module: result.module_name,
        error: error.message,
      })
      throw error
    }
  }

  async storeQAResult(
    callData: EvaluateRequest,
    qaResult: Record<string, any>,
    managerEmail: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("eavesly_transcription_qa")
      .insert({
        call_id: callData.call_id,
        agent_email: callData.agent_email ?? null,
        sfdc_lead_id: callData.sfdc_lead_id ?? null,
        overall_score: qaResult.overall_call_rating?.overall_score ?? null,
        compliance_rating: qaResult.overall_call_rating?.compliance_rating ?? null,
        customer_satisfaction_likely: qaResult.overall_call_rating?.customer_satisfaction_likely ?? null,
        manager_escalation: qaResult.call_overview?.manager_review_required ?? false,
        call_summary: qaResult.call_overview?.call_outcome ?? null,
        qa_json: qaResult,
        original_transcript: callData.transcript.transcript,
        transcription_link: callData.transcript_url ?? null,
        recording_link: callData.recording_link ?? null,
        manager_email: managerEmail || null,
        created_at: new Date().toISOString(),
      })

    if (error) {
      log("warn", "Failed to store QA result to legacy table", {
        callId: callData.call_id,
        error: error.message,
      })
    }
  }

  async logRequest(entry: {
    endpoint: string
    callId?: string
    status: string
    statusCode?: number
    errorMessage?: string
    errorDetails?: unknown
    rawBody?: string
    correlationId?: string
  }): Promise<void> {
    try {
      await this.client.from("eavesly_request_log").insert({
        endpoint: entry.endpoint,
        call_id: entry.callId ?? null,
        status: entry.status,
        status_code: entry.statusCode ?? null,
        error_message: entry.errorMessage ?? null,
        error_details: entry.errorDetails ?? null,
        raw_body: entry.rawBody?.slice(0, 10000) ?? null,
        correlation_id: entry.correlationId ?? null,
      })
    } catch {
      // Never let logging break the main flow
    }
  }

  /**
   * Fetch the current call's CRM disposition and lead id from Supabase by
   * call_id. Disposition-review needs this because the Regal event does not
   * carry the disposition — it lives in eavesly_calls. Returns null if the call
   * isn't found yet (advisory flow degrades to "no current disposition").
   */
  async getCallContext(
    callId: string,
  ): Promise<{ disposition: string | null; sfdc_lead_id: string | null; agent_email: string | null; talk_time: number | null } | null> {
    const { data, error } = await this.client
      .from("eavesly_calls")
      .select("disposition, sfdc_lead_id, agent_email, talk_time")
      .eq("call_id", callId)
      .limit(1)
      .maybeSingle()

    if (error) {
      log("warn", "Failed to fetch call context", { callId, error: error.message })
      return null
    }
    if (!data) return null
    return {
      disposition: data.disposition ?? null,
      sfdc_lead_id: data.sfdc_lead_id ?? null,
      agent_email: data.agent_email ?? null,
      talk_time: data.talk_time ?? null,
    }
  }

  /**
   * Look up an agent's Regal partner assignment by email. Source of truth for
   * partner follow-up routing (achieve_welcome_call_qa, gota_check, budget_inputs).
   * Populated hourly by a
   * Pipedream cron. Returns null when the agent isn't in the table (advisory
   * flow degrades to "not routed").
   */
  async getAgentRegalAssignment(
    agentEmail: string,
  ): Promise<{ partner_assignment: string | null; assignment_status: string | null } | null> {
    const { data, error } = await this.client
      .from("agent_regal_assignments")
      .select("partner_assignment, assignment_status")
      .eq("agent_email", agentEmail)
      .limit(1)
      .maybeSingle()

    if (error) {
      log("warn", "Failed to fetch agent regal assignment", { agentEmail, error: error.message })
      return null
    }
    if (!data) return null
    return {
      partner_assignment: data.partner_assignment ?? null,
      assignment_status: data.assignment_status ?? null,
    }
  }

  /**
   * Load the live CRM disposition catalog (active rows only). Drives the
   * disposition-review taxonomy so it never drifts from the Dispositions admin
   * screen. Returns [] (never throws) on error so the review degrades to a
   * catalog-less prompt rather than failing.
   */
  async getActiveDispositions(): Promise<Disposition[]> {
    const { data, error } = await this.client
      .from("eavesly_dispositions")
      .select("name, description, visibility, conversation_happened, ai_only")
      .eq("active", true)
      .order("name")

    if (error) {
      log("warn", "Failed to fetch dispositions", { error: error.message })
      return []
    }

    return (data ?? []).map((row: any) => ({
      name: row.name,
      description: row.description ?? null,
      visibility: row.visibility ?? null,
      conversation_happened: row.conversation_happened ?? null,
      ai_only: row.ai_only ?? false,
    }))
  }

  /**
   * Loads calls that happened before the current evaluation. SFDC lead id is
   * preferred; phone is a fallback for multi-call journeys whose lead id changed
   * or was absent on an earlier call.
   */
  async getPriorCallContext(
    lookup: PriorCallLookup,
  ): Promise<CallHistoryContext | null> {
    const { data: currentCall, error: currentCallError } = await this.client
      .from("eavesly_calls")
      .select("sfdc_lead_id, contact_phone, started_at")
      .eq("call_id", lookup.currentCallId)
      .limit(1)
      .maybeSingle()

    if (currentCallError) {
      log("warn", "Failed to fetch current call identity for history", {
        callId: lookup.currentCallId,
        error: currentCallError.message,
      })
    }

    const sfdcLeadId = lookup.sfdcLeadId ?? currentCall?.sfdc_lead_id ?? undefined
    const contactPhone = lookup.contactPhone ?? currentCall?.contact_phone ?? undefined
    const currentStartedAt = currentCall?.started_at ?? lookup.currentStartedAt ?? undefined

    type IdentityColumn = "sfdc_lead_id" | "contact_phone"
    const callColumns = "call_id, started_at, disposition, direction, talk_time, agent_email, campaign_name, notes"

    const loadCalls = async (column: IdentityColumn, value: string) => {
      let query = this.client
        .from("eavesly_calls")
        .select(callColumns)
        .eq(column, value)
        .neq("call_id", lookup.currentCallId)

      if (currentStartedAt) query = query.lt("started_at", currentStartedAt)

      return await query.order("started_at", { ascending: false }).limit(5)
    }

    let identity: { column: IdentityColumn; value: string } | null = null
    let callData: any[] | null = null

    if (sfdcLeadId) {
      const leadResult = await loadCalls("sfdc_lead_id", sfdcLeadId)
      if (leadResult.error) {
        log("warn", "Failed to fetch prior calls by lead id", {
          callId: lookup.currentCallId,
          error: leadResult.error.message,
        })
      } else if (leadResult.data && leadResult.data.length > 0) {
        identity = { column: "sfdc_lead_id", value: sfdcLeadId }
        callData = leadResult.data
      }
    }

    if (!callData && contactPhone) {
      const phoneResult = await loadCalls("contact_phone", contactPhone)
      if (phoneResult.error) {
        log("warn", "Failed to fetch prior calls by phone", {
          callId: lookup.currentCallId,
          error: phoneResult.error.message,
        })
        return null
      }
      if (phoneResult.data && phoneResult.data.length > 0) {
        identity = { column: "contact_phone", value: contactPhone }
        callData = phoneResult.data
      }
    }

    if (!identity || !callData || callData.length === 0) return null

    let countQuery = this.client
      .from("eavesly_calls")
      .select("call_id", { count: "exact", head: true })
      .eq(identity.column, identity.value)
      .neq("call_id", lookup.currentCallId)
    if (currentStartedAt) countQuery = countQuery.lt("started_at", currentStartedAt)

    const { count, error: countError } = await countQuery
    if (countError) {
      log("warn", "Failed to fetch prior call count", {
        callId: lookup.currentCallId,
        identity: identity.column,
        error: countError.message,
      })
    }

    const callIds = callData.map((row: any) => row.call_id)

    const { data: qaData, error: qaError } = await this.client
      .from("eavesly_transcription_qa")
      .select("call_id, call_summary, overall_score, compliance_rating")
      .in("call_id", callIds)

    if (qaError) {
      log("warn", "Failed to fetch prior call QA data", {
        callId: lookup.currentCallId,
        error: qaError.message,
      })
    }

    const qaMap = new Map(
      (qaData ?? []).map((row: any) => [row.call_id, row]),
    )

    const priorCalls: PriorCall[] = callData.map((row: any) => {
      const qa = qaMap.get(row.call_id)
      return {
        call_id: row.call_id,
        started_at: row.started_at,
        disposition: row.disposition,
        direction: row.direction,
        talk_time: row.talk_time,
        agent_email: row.agent_email,
        campaign_name: row.campaign_name,
        notes: row.notes,
        call_summary: qa?.call_summary ?? null,
        overall_score: qa?.overall_score ?? null,
        compliance_rating: qa?.compliance_rating ?? null,
      }
    })

    return {
      total_prior_calls: count ?? priorCalls.length,
      prior_calls: priorCalls,
    }
  }

  /**
   * Idempotently record a canonical Regal journey event into the durable ledger,
   * keyed on (regal_task_id, event_type). The full payload is stored as-is so the
   * resolver can join transcript + completed events later. Primary write for the
   * events endpoints — throws on error so the endpoint surfaces a real failure.
   */
  async recordRegalCallEvent(event: RegalCallEvent): Promise<void> {
    const { error } = await this.client.from("eavesly_regal_call_events").upsert(
      {
        regal_task_id: event.regal_task_id,
        event_type: event.event_type,
        agent_email: event.agent_email ?? null,
        source_event_id: event.source_event_id ?? null,
        payload: event,
        received_at: new Date().toISOString(),
      },
      { onConflict: "regal_task_id,event_type" },
    )

    if (error) {
      log("error", "Failed to record Regal call event", {
        regalTaskId: event.regal_task_id,
        eventType: event.event_type,
        error: error.message,
      })
      throw error
    }
  }

  /**
   * Project a completed call into eavesly_calls — the table the manager dashboard
   * reads (fetchDashboardData). The Regal-webhook QA path doesn't otherwise write
   * it, so without this the dashboard shows 0 calls even though QA + alerts run.
   * Keyed on call_id (unique) so redeliveries upsert idempotently; columns absent
   * from the Regal payload (sfdc_lead_id, agent_full_name, …) are left untouched
   * on update so any richer legacy row isn't clobbered. agent_full_name is filled
   * DB-side by the trg_eavesly_calls_resolve_agent_name trigger (agent_directory
   * lookup on agent_email — see quality-voice-view migration
   * agent_name_directory_backfill_and_trigger, 2026-07-21). Best-effort — logs and
   * swallows so a projection failure never fails the events endpoint or the QA
   * pipeline, matching recordRegalResolverPlan. `created_at` is bumped on redelivery
   * (not used for date filtering — the dashboard filters on started_at).
   */
  async upsertCallFromCompletedEvent(event: CallCompletedEvent): Promise<void> {
    const { error } = await this.client.from("eavesly_calls").upsert(
      { ...callCompletedEventToCallRow(event), created_at: new Date().toISOString() },
      { onConflict: "call_id" },
    )

    if (error) {
      log("warn", "Failed to upsert eavesly_calls from completed event", {
        callId: event.regal_task_id,
        error: error.message,
      })
    }
  }

  /**
   * Load the transcript/completed payloads recorded for a regal_task_id. Returns
   * an empty object (never throws) so the resolver degrades to "not enough events
   * yet" rather than failing the endpoint.
   */
  async getRegalCallEvents(regalTaskId: string): Promise<JoinedRegalEvents> {
    const { data, error } = await this.client
      .from("eavesly_regal_call_events")
      .select("event_type, payload")
      .eq("regal_task_id", regalTaskId)

    if (error) {
      log("warn", "Failed to fetch Regal call events", { regalTaskId, error: error.message })
      return {}
    }

    const joined: JoinedRegalEvents = {}
    for (const row of data ?? []) {
      if (row.event_type === "transcript_available") joined.transcript = row.payload
      else if (row.event_type === "call_completed") joined.completed = row.payload
    }
    return joined
  }

  /**
   * Best-effort store of a shadow resolver plan, keyed on regal_task_id. Advisory
   * (shadow-only) — logs a warning but never throws, so a plan-write failure can't
   * break the events endpoint.
   */
  async recordRegalResolverPlan(plan: ModuleTriggerPlan): Promise<void> {
    const { error } = await this.client.from("eavesly_regal_resolver_plans").upsert(
      {
        regal_task_id: plan.regal_task_id,
        enrolled: plan.enrolled,
        triggered_modules: plan.triggered,
        plan_json: plan,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "regal_task_id" },
    )

    if (error) {
      log("warn", "Failed to record Regal resolver plan", {
        regalTaskId: plan.regal_task_id,
        error: error.message,
      })
    }
  }

  /**
   * Backfill support: find resolver plans in [start,end) whose triggered modules
   * have no eavesly_module_results yet (call_id == regal_task_id for Regal-driven
   * evals). Returns only names/ids — no transcript, contact, or payload data — so
   * the admin route response stays PII-free. `missing_modules` is the per-task set
   * of triggered modules still missing a result; tasks with none are omitted.
   *
   * Only returns tasks that have a `transcript_available` event: without one,
   * callData can't be rebuilt, so the task is unprocessable and would otherwise
   * stall the batch. Candidates are ordered deterministically by
   * (computed_at, regal_task_id) so batch progress is stable across runs.
   */
  async getBackfillCandidates(
    start: string,
    end: string,
  ): Promise<Array<{ regal_task_id: string; triggered_modules: string[]; missing_modules: string[] }>> {
    const { data: plans, error: planErr } = await this.client
      .from("eavesly_regal_resolver_plans")
      .select("regal_task_id, triggered_modules, computed_at")
      .gte("computed_at", start)
      .lt("computed_at", end)

    if (planErr) {
      log("error", "Failed to fetch backfill resolver plans", { error: planErr.message })
      throw planErr
    }

    const withTriggers = (plans ?? []).filter(
      (p: any) => Array.isArray(p.triggered_modules) && p.triggered_modules.length > 0,
    )
    if (withTriggers.length === 0) return []

    const ids = withTriggers.map((p: any) => p.regal_task_id)
    const { data: results, error: resErr } = await this.client
      .from("eavesly_module_results")
      .select("call_id, module_name")
      .in("call_id", ids)

    if (resErr) {
      log("error", "Failed to fetch existing module results for backfill", { error: resErr.message })
      throw resErr
    }

    // Only tasks with a stored transcript are processable — the rest can't build
    // callData and must be excluded so they don't stall the batch.
    const { data: transcripts, error: txErr } = await this.client
      .from("eavesly_regal_call_events")
      .select("regal_task_id")
      .eq("event_type", "transcript_available")
      .in("regal_task_id", ids)

    if (txErr) {
      log("error", "Failed to fetch transcript events for backfill", { error: txErr.message })
      throw txErr
    }
    const haveTranscript = new Set((transcripts ?? []).map((r: any) => r.regal_task_id))

    const existing = new Map<string, Set<string>>()
    for (const row of results ?? []) {
      const set = existing.get(row.call_id) ?? new Set<string>()
      set.add(row.module_name)
      existing.set(row.call_id, set)
    }

    const candidates: Array<{
      regal_task_id: string
      triggered_modules: string[]
      missing_modules: string[]
      computed_at?: string
    }> = []
    for (const p of withTriggers) {
      if (!haveTranscript.has(p.regal_task_id)) continue
      const have = existing.get(p.regal_task_id) ?? new Set<string>()
      const missing = p.triggered_modules.filter((m: string) => !have.has(m))
      if (missing.length > 0) {
        candidates.push({
          regal_task_id: p.regal_task_id,
          triggered_modules: p.triggered_modules,
          missing_modules: missing,
          computed_at: p.computed_at,
        })
      }
    }

    // Deterministic order: computed_at, then regal_task_id as tiebreak.
    candidates.sort(
      (a, b) =>
        String(a.computed_at ?? "").localeCompare(String(b.computed_at ?? "")) ||
        a.regal_task_id.localeCompare(b.regal_task_id),
    )
    return candidates.map(({ computed_at, ...c }) => c)
  }

  /**
   * Read-only aggregate integrity report over the Regal pipeline for a window:
   * events -> resolver plans -> module results. Counts + regal_task_id samples
   * only — never transcripts, contacts, phones, payloads, or result_json — so
   * the admin route response stays PII-free.
   *
   * `graceCutoff` (ISO timestamp): plans computed after it are still "within
   * grace" and not counted as missing results, since their workflows may simply
   * not have finished yet.
   *
   * Operational note: keep windows bounded (for example 24h) so Supabase's
   * default response cap does not hide a larger backlog. If this report grows
   * beyond daily checks, add explicit .range() pagination.
   */
  async getRegalIntegrityReport(
    start: string,
    end: string,
    graceCutoff: string,
  ): Promise<{
    events: {
      transcript_available: number
      call_completed: number
      tasks_with_both: number
      transcript_only: number
      completed_only: number
    }
    plans: {
      total: number
      with_triggered_modules: number
      policy_version_null: number
      event_tasks_missing_plan: number
    }
    module_results: {
      plans_checked: number
      plans_within_grace: number
      plans_missing_results: number
      missing_module_counts: Record<string, number>
      sample_missing: Array<{ regal_task_id: string; missing_modules: string[] }>
    }
    warm_transfer: {
      triggered: number
      with_result: number
      with_partner_followup_result: number
    }
  }> {
    const { data: events, error: evErr } = await this.client
      .from("eavesly_regal_call_events")
      .select("regal_task_id, event_type")
      .gte("received_at", start)
      .lt("received_at", end)
    if (evErr) {
      log("error", "Integrity report: failed to fetch events", { error: evErr.message })
      throw evErr
    }

    // policy_version lives inside plan_json; select only that key so the rest
    // of the plan (decision reasons etc.) never leaves the database.
    const { data: plans, error: planErr } = await this.client
      .from("eavesly_regal_resolver_plans")
      .select("regal_task_id, triggered_modules, computed_at, policy_version:plan_json->policy_version")
      .gte("computed_at", start)
      .lt("computed_at", end)
    if (planErr) {
      log("error", "Integrity report: failed to fetch resolver plans", { error: planErr.message })
      throw planErr
    }

    // Event stream balance: transcript_available and call_completed should pair up.
    const byTask = new Map<string, Set<string>>()
    for (const e of events ?? []) {
      const set = byTask.get(e.regal_task_id) ?? new Set<string>()
      set.add(e.event_type)
      byTask.set(e.regal_task_id, set)
    }
    let tasksWithBoth = 0
    let transcriptOnly = 0
    let completedOnly = 0
    for (const types of byTask.values()) {
      const t = types.has("transcript_available")
      const c = types.has("call_completed")
      if (t && c) tasksWithBoth++
      else if (t) transcriptOnly++
      else if (c) completedOnly++
    }

    // Resolver plan lag: event tasks in the window with no plan row at all
    // (checked without the window filter so a plan computed just outside it
    // doesn't false-positive). No grace period here: plans are written
    // synchronously at event ingest, so absence is a real gap, not lag.
    const planIds = new Set((plans ?? []).map((p: any) => p.regal_task_id))
    const unplanned = [...byTask.keys()].filter((id) => !planIds.has(id))
    let eventTasksMissingPlan = 0
    if (unplanned.length > 0) {
      const { data: existing, error: exErr } = await this.client
        .from("eavesly_regal_resolver_plans")
        .select("regal_task_id")
        .in("regal_task_id", unplanned)
      if (exErr) {
        log("error", "Integrity report: failed to check plan existence", { error: exErr.message })
        throw exErr
      }
      const found = new Set((existing ?? []).map((r: any) => r.regal_task_id))
      eventTasksMissingPlan = unplanned.filter((id) => !found.has(id)).length
    }

    const withTriggers = (plans ?? []).filter(
      (p: any) => Array.isArray(p.triggered_modules) && p.triggered_modules.length > 0,
    )
    const policyVersionNull = (plans ?? []).filter((p: any) => p.policy_version == null).length

    // Missing module results: only judge plans past the grace cutoff.
    const graceTime = new Date(graceCutoff).getTime()
    const pastGrace = withTriggers.filter((p: any) => new Date(String(p.computed_at)).getTime() <= graceTime)
    const withinGrace = withTriggers.length - pastGrace.length

    const resultsByCall = new Map<string, Set<string>>()
    if (pastGrace.length > 0) {
      const { data: results, error: resErr } = await this.client
        .from("eavesly_module_results")
        .select("call_id, module_name")
        .in("call_id", pastGrace.map((p: any) => p.regal_task_id))
      if (resErr) {
        log("error", "Integrity report: failed to fetch module results", { error: resErr.message })
        throw resErr
      }
      for (const r of results ?? []) {
        const set = resultsByCall.get(r.call_id) ?? new Set<string>()
        set.add(r.module_name)
        resultsByCall.set(r.call_id, set)
      }
    }

    const missingModuleCounts: Record<string, number> = {}
    const sampleMissing: Array<{ regal_task_id: string; missing_modules: string[] }> = []
    let plansMissingResults = 0
    let wtTriggered = 0
    let wtWithResult = 0
    let wtWithFollowup = 0
    for (const p of pastGrace) {
      const have = resultsByCall.get(p.regal_task_id) ?? new Set<string>()
      const missing = (p.triggered_modules as string[]).filter((m) => !have.has(m))
      if (missing.length > 0) {
        plansMissingResults++
        for (const m of missing) missingModuleCounts[m] = (missingModuleCounts[m] ?? 0) + 1
        if (sampleMissing.length < 10) {
          sampleMissing.push({ regal_task_id: p.regal_task_id, missing_modules: missing })
        }
      }

      // warm_transfer -> partner follow-up health. Not every warm transfer routes
      // to a partner (depends on agent assignment), so followup < with_result is
      // expected — the counts are for trend-watching, not a hard invariant.
      if ((p.triggered_modules as string[]).includes(MODULE_NAMES.WARM_TRANSFER)) {
        wtTriggered++
        if (have.has(MODULE_NAMES.WARM_TRANSFER)) wtWithResult++
        if (have.has(MODULE_NAMES.ACHIEVE_WELCOME_CALL_QA)) wtWithFollowup++
      }
    }

    const countEvents = (type: string) => (events ?? []).filter((e: any) => e.event_type === type).length

    return {
      events: {
        transcript_available: countEvents("transcript_available"),
        call_completed: countEvents("call_completed"),
        tasks_with_both: tasksWithBoth,
        transcript_only: transcriptOnly,
        completed_only: completedOnly,
      },
      plans: {
        total: (plans ?? []).length,
        with_triggered_modules: withTriggers.length,
        policy_version_null: policyVersionNull,
        event_tasks_missing_plan: eventTasksMissingPlan,
      },
      module_results: {
        plans_checked: pastGrace.length,
        plans_within_grace: withinGrace,
        plans_missing_results: plansMissingResults,
        missing_module_counts: missingModuleCounts,
        sample_missing: sampleMissing,
      },
      warm_transfer: {
        triggered: wtTriggered,
        with_result: wtWithResult,
        with_partner_followup_result: wtWithFollowup,
      },
    }
  }

  /**
   * Read-only duplicate audit scoped to a set of regal_task_ids (call_id ==
   * regal_task_id). Counts rows that share a key beyond the first occurrence in
   * three tables. Purely informational — all three tables use upsert onConflict
   * constraints, so duplicates are not expected; this surfaces any that slipped
   * in without deleting anything. Returns key/count only, no payloads.
   */
  async getDuplicateAudit(regalTaskIds: string[]): Promise<{
    duplicate_module_results: number
    duplicate_call_events: number
    duplicate_resolver_plans: number
  }> {
    const empty = { duplicate_module_results: 0, duplicate_call_events: 0, duplicate_resolver_plans: 0 }
    if (regalTaskIds.length === 0) return empty

    const countDupes = (rows: any[], key: (r: any) => string): number => {
      const seen = new Set<string>()
      let dupes = 0
      for (const r of rows) {
        const k = key(r)
        if (seen.has(k)) dupes++
        else seen.add(k)
      }
      return dupes
    }

    const [mr, ce, rp] = await Promise.all([
      this.client.from("eavesly_module_results").select("call_id, module_name").in("call_id", regalTaskIds),
      this.client.from("eavesly_regal_call_events").select("regal_task_id, event_type").in("regal_task_id", regalTaskIds),
      this.client.from("eavesly_regal_resolver_plans").select("regal_task_id").in("regal_task_id", regalTaskIds),
    ])

    if (mr.error || ce.error || rp.error) {
      log("warn", "Duplicate audit query error", {
        error: mr.error?.message ?? ce.error?.message ?? rp.error?.message,
      })
      return empty
    }

    return {
      duplicate_module_results: countDupes(mr.data ?? [], (r) => `${r.call_id}|${r.module_name}`),
      duplicate_call_events: countDupes(ce.data ?? [], (r) => `${r.regal_task_id}|${r.event_type}`),
      duplicate_resolver_plans: countDupes(rp.data ?? [], (r) => r.regal_task_id),
    }
  }

  /**
   * Load the active resolver policy — the latest row of eavesly_resolver_policies.
   * Any missing row, invalid policy_json, or query error falls back to
   * DEFAULT_RESOLVER_POLICY (policyVersion null): a bad/absent config row must
   * never stop QA triggering. The table won't exist until the PSAI-202 SQL is
   * applied manually, so the fallback path is expected in production until then.
   */
  async getResolverPolicy(): Promise<ActiveResolverPolicy> {
    try {
      const { data, error } = await this.client
        .from("eavesly_resolver_policies")
        .select("id, policy_json")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      const active = parseResolverPolicyRow(data)
      if (data && active.policyVersion === null) {
        log("warn", "Invalid resolver policy row; using DEFAULT_RESOLVER_POLICY", {
          rowId: (data as any).id,
        })
      }
      return active
    } catch (e) {
      log("warn", "Failed to load resolver policy; using DEFAULT_RESOLVER_POLICY", {
        error: e instanceof Error ? e.message : String(e),
      })
      return { policy: DEFAULT_RESOLVER_POLICY, policyVersion: null }
    }
  }

  /**
   * Mirror one module's deployed prompt into eavesly_module_prompts. Upserts on
   * module_name and only bumps deployed_at when the content hash changed, so the
   * timestamp reads as "last change deployed". Returns true when the row was new
   * or its hash differed. Throws on write error so the sync endpoint surfaces it.
   */
  async upsertModulePrompt(args: {
    moduleName: string
    promptText: string
    contentHash: string
  }): Promise<boolean> {
    const { moduleName, promptText, contentHash } = args

    const { data: existing, error: readError } = await this.client
      .from("eavesly_module_prompts")
      .select("content_hash")
      .eq("module_name", moduleName)
      .maybeSingle()

    if (readError) {
      log("error", "Failed to read module prompt before sync", {
        module: moduleName,
        error: readError.message,
      })
      throw readError
    }

    const changed = !existing || (existing as any).content_hash !== contentHash
    if (!changed) return false

    const { error } = await this.client.from("eavesly_module_prompts").upsert(
      {
        module_name: moduleName,
        prompt_text: promptText,
        content_hash: contentHash,
        deployed_at: new Date().toISOString(),
      },
      { onConflict: "module_name" },
    )

    if (error) {
      log("error", "Failed to upsert module prompt", { module: moduleName, error: error.message })
      throw error
    }
    return true
  }

  /** Loads the aggregate, PII-free snapshot used by public operational health routes. */
  async getMonitoringSnapshot(): Promise<MonitoringSnapshot> {
    const { data, error } = await this.client.rpc("eavesly_monitoring_snapshot_v2")
    if (error) {
      log("error", "Monitoring snapshot RPC failed", {
        operation: "eavesly_monitoring_snapshot_v2",
        error: "rpc_failed",
      })
      throw new Error("monitoring snapshot unavailable")
    }

    const row = Array.isArray(data) ? data[0] : undefined
    try {
      return parseMonitoringSnapshot(row)
    } catch {
      log("error", "Monitoring snapshot RPC returned invalid data", {
        operation: "eavesly_monitoring_snapshot_v2",
        error: "invalid_response",
      })
      throw new Error("monitoring snapshot unavailable")
    }
  }

  async healthCheck(): Promise<boolean> {
    const { error } = await this.client
      .from("eavesly_module_results")
      .select("call_id")
      .limit(1)

    return !error
  }
}
