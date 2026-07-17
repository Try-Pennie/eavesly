import { describe, expect, it } from "vitest"
import {
  ProfileRecapRequestSchema,
  SalesforceLeadIdSchema,
} from "./profile-recap"

describe("SalesforceLeadIdSchema", () => {
  it("accepts only 18-character Salesforce Lead IDs", () => {
    expect(SalesforceLeadIdSchema.safeParse("00Q123456789ABCDEF").success).toBe(true)
    expect(SalesforceLeadIdSchema.safeParse("00Q123456789ABC").success).toBe(false)
  })

  it("rejects non-Lead prefixes, wrong lengths, and punctuation", () => {
    expect(SalesforceLeadIdSchema.safeParse("001123456789ABC").success).toBe(false)
    expect(SalesforceLeadIdSchema.safeParse("00Q123").success).toBe(false)
    expect(SalesforceLeadIdSchema.safeParse("00Q123456789AB-").success).toBe(false)
  })
})

describe("ProfileRecapRequestSchema", () => {
  it("rejects unknown request fields", () => {
    const result = ProfileRecapRequestSchema.safeParse({
      p_sfdc_lead_id: "00Q123456789ABCDEF",
      extra: "not accepted",
    })

    expect(result.success).toBe(false)
  })
})
