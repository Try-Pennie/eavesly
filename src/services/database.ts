import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Bindings } from "../types/env"
import type { ModuleConfig, ModuleResult } from "../modules/types"
import { log } from "../utils/logger"

export class DatabaseService {
  private client: SupabaseClient
  private configCache: ModuleConfig[] | null = null
  private configCacheTime = 0
  private readonly CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  constructor(env: Bindings) {
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  }

  async getModuleConfigs(): Promise<ModuleConfig[]> {
    const now = Date.now()
    if (this.configCache && now - this.configCacheTime < this.CACHE_TTL_MS) {
      return this.configCache
    }

    const { data, error } = await this.client
      .from("eavesly_module_config")
      .select("module_name, enabled, trigger_dispositions, trigger_campaigns, min_talk_time, config_json")

    if (error) {
      log("error", "Failed to fetch module configs", { error: error.message })
      if (this.configCache) return this.configCache
      throw error
    }

    this.configCache = data as ModuleConfig[]
    this.configCacheTime = now
    return this.configCache
  }

  async storeModuleResult(
    callId: string,
    result: ModuleResult,
    alertSent: boolean,
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
    callId: string,
    qaResult: unknown,
    processingTimeMs: number,
  ): Promise<void> {
    const { error } = await this.client
      .from("eavesly_transcription_qa")
      .upsert(
        {
          call_id: callId,
          qa_result: qaResult,
          processing_time_ms: processingTimeMs,
          created_at: new Date().toISOString(),
        },
        { onConflict: "call_id" },
      )

    if (error) {
      log("warn", "Failed to store QA result to legacy table", {
        callId,
        error: error.message,
      })
    }
  }

  async healthCheck(): Promise<boolean> {
    const { error } = await this.client
      .from("eavesly_module_config")
      .select("module_name")
      .limit(1)

    return !error
  }
}
