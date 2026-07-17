import { createClient } from "@supabase/supabase-js"
import type { Bindings } from "../types/env"
import {
  LeadProfileRecapSchema,
  type LeadProfileRecap,
  type SalesforceLeadId,
} from "../schemas/profile-recap"

const PROFILE_RECAP_RPC = "get_lead_profile_recap_agent_view" as const

type ProfileRecapRpcArgs = {
  readonly p_sfdc_lead_id: SalesforceLeadId
}

type ProfileRecapRpcResponse = {
  readonly data: unknown
  readonly error: unknown | null
}

type ExecuteProfileRecapRpc = (
  functionName: typeof PROFILE_RECAP_RPC,
  args: ProfileRecapRpcArgs,
) => Promise<ProfileRecapRpcResponse>

/** Result of the narrow profile recap lookup capability. */
export type ProfileRecapLookupResult =
  | { readonly _tag: "success"; readonly recap: LeadProfileRecap }
  | { readonly _tag: "failure"; readonly reason: "rpc_error" | "invalid_response" }

/** Read profile recaps without exposing Supabase protocol details to callers. */
export interface ProfileRecaps {
  /** Fetch a profile recap for one parsed Salesforce Lead ID. */
  getBySalesforceLeadId(leadId: SalesforceLeadId): Promise<ProfileRecapLookupResult>
}

/** Create the service-role-backed adapter for the fixed profile recap RPC. */
export function createSupabaseProfileRecaps(
  env: Bindings,
  executeRpc?: ExecuteProfileRecapRpc,
): ProfileRecaps {
  const runRpc: ExecuteProfileRecapRpc = executeRpc ?? (async (functionName, args) => {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await client.rpc(functionName, args)
    return { data, error }
  })

  return {
    async getBySalesforceLeadId(leadId) {
      let response: ProfileRecapRpcResponse
      try {
        response = await runRpc(PROFILE_RECAP_RPC, { p_sfdc_lead_id: leadId })
      } catch {
        return { _tag: "failure", reason: "rpc_error" }
      }

      if (response.error !== null) {
        return { _tag: "failure", reason: "rpc_error" }
      }

      const parsed = LeadProfileRecapSchema.safeParse(response.data)
      if (!parsed.success || parsed.data.lead_id !== leadId) {
        return { _tag: "failure", reason: "invalid_response" }
      }

      return { _tag: "success", recap: parsed.data }
    },
  }
}
