import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Bindings } from "../types/env"
import type { ModuleResult, CallHistoryContext, PriorCall, Disposition } from "../modules/types"
import type { EvaluateRequest } from "../schemas/requests"
import type { SalesFloorRows } from "./sales-floor-insights"
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
  ): Promise<{ disposition: string | null; sfdc_lead_id: string | null } | null> {
    const { data, error } = await this.client
      .from("eavesly_calls")
      .select("disposition, sfdc_lead_id")
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
   * Fetch redacted rows for the Sales Floor Insights report over [startIso,
   * endIso). Selects ONLY aggregate-safe columns — no transcripts, names,
   * phones, summaries, or recording links reach the report. Each table is
   * windowed by its own timestamp (calls.started_at, qa/module.created_at);
   * weekly boundary mismatches between a call and its later QA row are
   * explicitly called out in the report documentation.
   * Note: paginates at 1000/page (Supabase's hard cap); fine for weekly +
   * 28-day baseline volume. If this ever needs months of data, push the
   * aggregation into a Postgres view/RPC instead of pulling rows into the Worker.
   */
  async getSalesFloorRows(startIso: string, endIso: string): Promise<SalesFloorRows> {
    const [calls, qa, modules] = await Promise.all([
      this.fetchWindow("eavesly_calls", "started_at, agent_email, talk_time, disposition", "started_at", startIso, endIso),
      this.fetchWindow(
        "eavesly_transcription_qa",
        "created_at, agent_email, manager_email, overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation",
        "created_at",
        startIso,
        endIso,
      ),
      this.fetchWindow("eavesly_module_results", "created_at, module_name, has_violation, agent_email", "created_at", startIso, endIso),
    ])
    return { calls, qa, modules } as SalesFloorRows
  }

  private async fetchWindow(
    table: string,
    columns: string,
    tsColumn: string,
    startIso: string,
    endIso: string,
  ): Promise<any[]> {
    const pageSize = 1000
    const out: any[] = []
    for (let from = 0; from < 200_000; from += pageSize) {
      const { data, error } = await this.client
        .from(table)
        .select(columns)
        .gte(tsColumn, startIso)
        .lt(tsColumn, endIso)
        .order(tsColumn, { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) {
        log("error", "Failed to fetch sales-floor rows", { table, error: error.message })
        throw new Error(`Failed to fetch sales-floor rows from ${table}`)
      }
      if (!data?.length) break
      out.push(...data)
      if (data.length < pageSize) break
    }
    return out
  }

  async healthCheck(): Promise<boolean> {
    const { error } = await this.client
      .from("eavesly_module_results")
      .select("call_id")
      .limit(1)

    return !error
  }
}
