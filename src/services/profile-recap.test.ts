import { describe, expect, it } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { SalesforceLeadIdSchema } from "../schemas/profile-recap"
import { createSupabaseProfileRecaps } from "./profile-recap"

const LEAD_ID = SalesforceLeadIdSchema.parse("00Q123456789ABCDEF")

describe("Supabase profile recaps", () => {
  it("calls only the fixed profile recap RPC with the parsed lead ID", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = []
    const recap = { lead_id: LEAD_ID, total_calls: 0, timeline: [] }
    const profileRecaps = createSupabaseProfileRecaps(
      createEnv(),
      async (functionName, args) => {
        calls.push({ functionName, args })
        return { data: recap, error: null }
      },
    )

    const result = await profileRecaps.getBySalesforceLeadId(LEAD_ID)

    expect(result).toEqual({ _tag: "success", recap })
    expect(calls).toEqual([
      {
        functionName: "get_lead_profile_recap_agent_view",
        args: { p_sfdc_lead_id: LEAD_ID },
      },
    ])
  })

  it("classifies an invalid RPC response", async () => {
    const profileRecaps = createSupabaseProfileRecaps(
      createEnv(),
      async () => ({
        data: { lead_id: LEAD_ID, total_calls: "not-a-number", timeline: [] },
        error: null,
      }),
    )

    const result = await profileRecaps.getBySalesforceLeadId(LEAD_ID)

    expect(result).toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("rejects a recap for a different lead ID", async () => {
    const profileRecaps = createSupabaseProfileRecaps(
      createEnv(),
      async () => ({
        data: {
          lead_id: "00Q123456789DEFGHI",
          total_calls: 0,
          timeline: [],
        },
        error: null,
      }),
    )

    const result = await profileRecaps.getBySalesforceLeadId(LEAD_ID)

    expect(result).toEqual({ _tag: "failure", reason: "invalid_response" })
  })

  it("classifies a thrown RPC execution failure", async () => {
    const profileRecaps = createSupabaseProfileRecaps(
      createEnv(),
      async () => {
        throw new Error("sensitive thrown detail")
      },
    )

    const result = await profileRecaps.getBySalesforceLeadId(LEAD_ID)

    expect(result).toEqual({ _tag: "failure", reason: "rpc_error" })
  })

  it("classifies an RPC error without exposing its details", async () => {
    const profileRecaps = createSupabaseProfileRecaps(
      createEnv(),
      async () => ({
        data: null,
        error: { message: "sensitive upstream detail" },
      }),
    )

    const result = await profileRecaps.getBySalesforceLeadId(LEAD_ID)

    expect(result).toEqual({ _tag: "failure", reason: "rpc_error" })
  })
})
