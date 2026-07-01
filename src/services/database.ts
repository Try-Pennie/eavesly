import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Bindings } from "../types/env"
import type { ModuleResult, CallHistoryContext, PriorCall, Disposition } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import type { RegalCallEvent, JoinedRegalEvents, ModuleTriggerPlan } from "./regal-events"
import { log } from "../utils/logger"

export class DatabaseService {
  private client: SupabaseClient

  constructor(env: Bindings) {
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
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
   * warm-transfer → achieve_welcome_call_qa routing. Populated hourly by a
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

  async getPriorCallContext(
    sfdcLeadId: string,
    currentCallId: string,
  ): Promise<CallHistoryContext | null> {
    const { count, error: countError } = await this.client
      .from("eavesly_calls")
      .select("call_id", { count: "exact", head: true })
      .eq("sfdc_lead_id", sfdcLeadId)
      .neq("call_id", currentCallId)

    if (countError) {
      log("warn", "Failed to fetch prior call count", {
        sfdcLeadId,
        error: countError.message,
      })
    }

    const totalPriorCalls = count ?? 0

    const { data: callData, error: callError } = await this.client
      .from("eavesly_calls")
      .select("call_id, started_at, disposition, direction, talk_time, agent_email, campaign_name, notes")
      .eq("sfdc_lead_id", sfdcLeadId)
      .neq("call_id", currentCallId)
      .order("started_at", { ascending: false })
      .limit(5)

    if (callError) {
      log("warn", "Failed to fetch prior call context", {
        sfdcLeadId,
        error: callError.message,
      })
      return null
    }

    if (!callData || callData.length === 0) return null

    const callIds = callData.map((row: any) => row.call_id)

    const { data: qaData, error: qaError } = await this.client
      .from("eavesly_transcription_qa")
      .select("call_id, call_summary, overall_score, compliance_rating")
      .in("call_id", callIds)

    if (qaError) {
      log("warn", "Failed to fetch prior call QA data", {
        sfdcLeadId,
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
      total_prior_calls: totalPriorCalls || priorCalls.length,
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

  async healthCheck(): Promise<boolean> {
    const { error } = await this.client
      .from("eavesly_module_results")
      .select("call_id")
      .limit(1)

    return !error
  }
}
