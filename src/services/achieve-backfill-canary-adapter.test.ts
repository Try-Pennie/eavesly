import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import { createEnv } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import type { ModuleResult } from "../modules/types"
import {
  createProductionAchieveBackfillGrader,
  createSupabaseAchieveBackfillCanaryDependencies,
  type AchieveBackfillCanaryDataAccess,
} from "./achieve-backfill-canary-adapter"

const callId = AchieveBackfillCallIdSchema.parse("approved-call-01")
const modelResponse = {
  script_adherence: {
    greeting_and_identity_completed: true,
    recording_disclosure_provided: true,
    company_credibility_covered: true,
    call_agenda_provided: true,
    dedicated_account_deposits_explained: true,
    creditor_negotiation_explained: true,
    settlement_authorizations_explained: true,
    dashboard_account_setup_covered: true,
    tools_and_resources_covered: true,
    closing_and_support_provided: true,
    overall_script_adherence: "full",
    missing_elements: [],
    key_evidence_quotes: [],
    violation: false,
    violation_reason: "",
  },
  agent_identity_check: {
    correctly_identified_as_fdr: true,
    issue_quote: null,
  },
  call_overview: {
    call_outcome: "completed",
    agent_tone: "professional",
    client_engagement: "engaged",
    delivery_naturalness: "natural",
    handoff_quality: "smooth",
    notes: "",
  },
  assessment_confidence: {
    score: 0.9,
    level: "high",
    rationale: "bounded segment",
    limitations: [],
  },
}

class RecordingLlm {
  readonly userPrompts: Array<string> = []

  async getStructuredResponse<T>(
    _systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    _schemaName: string,
    _options: { temperature?: number } = {},
  ): Promise<T> {
    this.userPrompts.push(userPrompt)
    return schema.parse(modelResponse)
  }
}

const moduleResult: ModuleResult = {
  module_name: "achieve_welcome_call_qa",
  result: {
    backfill: {
      audit_only: true,
      approved_digest: "approved-digest",
      batch_id: "psai-245-gate-2-approved-manifest",
      canary_id: "psai-245-gate-2-one-call-canary",
      canary_call_id: callId,
      manifest_version: "psai-245-achieve-backfill-manifest-v1",
      snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
    },
  },
  has_violation: false,
  violation_type: null,
  processing_time_ms: 1,
}

describe("PSAI-245 Gate 2 production boundaries", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("uses production segmentation and sends only the bounded welcome segment to the LLM", async () => {
    const llm = new RecordingLlm()
    const transcript = [
      "[handling agent]: PRIVATE PRE-HANDOFF MUST STAY OUT",
      "[contact]: okay",
      "[transfer agent]: Please enter the customer's 10 digit phone number.",
      "[transfer agent]: Thank you for calling the Freedom Debt Relief disclosure line.",
      "[transfer agent]: Hi, this is Avery with Freedom Debt Relief on a recorded line.",
      "[contact]: hello",
      "[transfer agent]: Welcome to your program and this call is recorded.",
      "[transfer agent]: Your deposits go into a dedicated account.",
      "[transfer agent]: We negotiate with your creditors.",
      "[transfer agent]: You authorize settlements from your dashboard.",
      "[transfer agent]: Let us set up your client dashboard.",
      "[transfer agent]: Your program guide has tools and resources.",
      "[transfer agent]: Call customer service for support. Have a great day.",
      "[handling agent]: PRIVATE TRAILING CONTENT MUST STAY OUT",
    ].join("\n")

    const grade = createProductionAchieveBackfillGrader(
      createEnv(),
      llm,
    )
    const result = await grade(callId, transcript)

    expect(result.module_name).toBe("achieve_welcome_call_qa")
    expect(llm.userPrompts).toHaveLength(1)
    expect(llm.userPrompts[0]).toContain("Hi, this is Avery")
    expect(llm.userPrompts[0]).not.toContain("PRIVATE PRE-HANDOFF")
    expect(llm.userPrompts[0]).not.toContain("PRIVATE TRAILING CONTENT")
    expect(llm.userPrompts[0]).not.toContain("Please enter the customer's 10 digit phone number")
  })

  it("parses only categorical nested provenance and treats non-boolean true markers as ordinary", async () => {
    const dataAccess: AchieveBackfillCanaryDataAccess = {
      inspect: async () => ({
        calls: { data: [{ call_id: callId }], error: null },
        results: {
          data: [{
            call_id: callId,
            audit_only_marker: "true",
            approved_digest: "digest",
            batch_id: "batch",
            canary_id: "canary",
            canary_call_id: callId,
            manifest_version: "version",
            snapshot_cutoff: "cutoff",
          }],
          error: null,
        },
      }),
      loadTranscript: async () => ({ data: [], error: null }),
      finalize: async () => ({ data: [], error: null }),
    }
    const dependencies = createSupabaseAchieveBackfillCanaryDependencies(
      createEnv(),
      dataAccess,
      async () => moduleResult,
    )

    expect(await dependencies.inspect([callId])).toEqual({
      _tag: "success",
      knownCallIds: [callId],
      existingResults: [{
        callId,
        provenance: {
          auditOnly: false,
          approvedDigest: "digest",
          batchId: "batch",
          canaryId: "canary",
          canaryCallId: callId,
          manifestVersion: "version",
          snapshotCutoff: "cutoff",
        },
      }],
    })
  })

  it("rechecks with call-ID and categorical provenance projections only", async () => {
    const urls: Array<URL> = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      urls.push(url)
      const data = url.pathname.endsWith("/eavesly_calls")
        ? [{ call_id: callId }]
        : []
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const dependencies = createSupabaseAchieveBackfillCanaryDependencies(createEnv())

    expect(await dependencies.inspect([callId])).toEqual({
      _tag: "success",
      knownCallIds: [callId],
      existingResults: [],
    })
    const resultUrl = urls.find((url) => url.pathname.endsWith("/eavesly_module_results"))
    expect(resultUrl?.searchParams.get("select")).toBe([
      "call_id",
      "audit_only_marker:result_json->backfill->audit_only",
      "approved_digest:result_json->backfill->>approved_digest",
      "batch_id:result_json->backfill->>batch_id",
      "canary_id:result_json->backfill->>canary_id",
      "canary_call_id:result_json->backfill->>canary_call_id",
      "manifest_version:result_json->backfill->>manifest_version",
      "snapshot_cutoff:result_json->backfill->>snapshot_cutoff",
    ].join(","))
    expect(resultUrl?.searchParams.get("module_name")).toBe("eq.achieve_welcome_call_qa")
    expect(resultUrl?.search).not.toMatch(/transcript|phone|email|lead|summary|recording/)
  })

  it("uses the atomic finalize RPC with alert suppression and no private metadata", async () => {
    const requests: Array<Request> = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())
      return new Response(JSON.stringify([{ status: "inserted", reason: null }]), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    })
    const dependencies = createSupabaseAchieveBackfillCanaryDependencies(createEnv())

    expect(await dependencies.finalize([callId], {
      callId,
      moduleResult,
      alertSent: false,
    })).toEqual({ _tag: "inserted" })

    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request.method).toBe("POST")
    expect(request.url).toContain("/rest/v1/rpc/eavesly_finalize_achieve_backfill_canary_v1")
    expect(request.headers.get("Prefer") ?? "").not.toContain("resolution=merge-duplicates")
    const body: unknown = await request.json()
    expect(body).toEqual({
      p_call_ids: [callId],
      p_canary_call_id: callId,
      p_result_json: moduleResult.result,
      p_has_violation: false,
      p_violation_type: null,
      p_processing_time_ms: 1,
      p_approved_digest: "approved-digest",
      p_manifest_version: "psai-245-achieve-backfill-manifest-v1",
      p_snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
    })
    expect(JSON.stringify(body)).not.toMatch(/agent_email|contact_|phone|lead|summary|recording|transcript/)
  })

  it("parses atomic idempotency and different-member conflict statuses", async () => {
    let response: unknown = [{ status: "already_completed", reason: null }]
    const dataAccess: AchieveBackfillCanaryDataAccess = {
      inspect: async () => ({ calls: { data: [], error: null }, results: { data: [], error: null } }),
      loadTranscript: async () => ({ data: [], error: null }),
      finalize: async () => ({ data: response, error: null }),
    }
    const dependencies = createSupabaseAchieveBackfillCanaryDependencies(
      createEnv(),
      dataAccess,
      async () => moduleResult,
    )
    const record = { callId, moduleResult, alertSent: false as const }

    expect(await dependencies.finalize([callId], record)).toEqual({
      _tag: "already_completed",
    })
    response = [{ status: "rejected", reason: "canary_already_used" }]
    expect(await dependencies.finalize([callId], record)).toEqual({
      _tag: "rejected",
      reason: "canary_already_used",
    })
  })
})
