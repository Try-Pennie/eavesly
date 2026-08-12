import { afterEach, describe, expect, it, vi } from "vitest"
import { createEnv } from "../../test/helpers/mock-env"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import { createSupabaseAchieveBackfillInspector } from "./achieve-backfill-inspector"

const first = AchieveBackfillCallIdSchema.parse("call-1")
const second = AchieveBackfillCallIdSchema.parse("call-2")
const third = AchieveBackfillCallIdSchema.parse("call-3")
const fourth = AchieveBackfillCallIdSchema.parse("call-4")
const fifth = AchieveBackfillCallIdSchema.parse("call-5")

describe("Supabase Achieve backfill inspector", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exempts only exact result_json.backfill.audit_only=true from ordinary conflicts", async () => {
    const inspector = createSupabaseAchieveBackfillInspector(
      createEnv(),
      async () => ({
        calls: {
          data: [
            { call_id: first },
            { call_id: second },
            { call_id: third },
            { call_id: fourth },
            { call_id: fifth },
          ],
          error: null,
        },
        ordinaryResults: {
          data: [
            { call_id: first, audit_only_marker: true },
            { call_id: second, audit_only_marker: false },
            { call_id: third, audit_only_marker: null },
            { call_id: fourth, audit_only_marker: "true" },
            { call_id: fifth },
          ],
          error: null,
        },
      }),
    )

    expect(await inspector.inspect([first, second, third, fourth, fifth])).toEqual({
      _tag: "success",
      knownCallIds: [first, second, third, fourth, fifth],
      ordinaryResultCallIds: [second, third, fourth, fifth],
    })
  })

  it("uses the nested JSON marker projection without text coercion", async () => {
    const requestedUrls: URL[] = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requestedUrls.push(url)
      const data = url.pathname.endsWith("/eavesly_calls")
        ? [{ call_id: first }]
        : []
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const inspector = createSupabaseAchieveBackfillInspector(createEnv())
    expect(await inspector.inspect([first])).toEqual({
      _tag: "success",
      knownCallIds: [first],
      ordinaryResultCallIds: [],
    })

    const resultRequest = requestedUrls.find((url) =>
      url.pathname.endsWith("/eavesly_module_results"),
    )
    expect(resultRequest?.searchParams.get("select")).toBe(
      "call_id,audit_only_marker:result_json->backfill->audit_only",
    )
    expect(resultRequest?.searchParams.get("module_name")).toBe(
      "eq.achieve_welcome_call_qa",
    )
  })

  it("fails closed on malformed or out-of-scope read projections", async () => {
    const malformed = createSupabaseAchieveBackfillInspector(
      createEnv(),
      async () => ({
        calls: { data: [{ call_id: first }], error: null },
        ordinaryResults: {
          data: [{ call_id: first, unexpected_field: true }],
          error: null,
        },
      }),
    )
    const outOfScope = createSupabaseAchieveBackfillInspector(
      createEnv(),
      async () => ({
        calls: { data: [{ call_id: second }], error: null },
        ordinaryResults: { data: [], error: null },
      }),
    )

    expect(await malformed.inspect([first])).toEqual({
      _tag: "failure",
      reason: "invalid_response",
    })
    expect(await outOfScope.inspect([first])).toEqual({
      _tag: "failure",
      reason: "invalid_response",
    })
  })

  it("returns a categorical failure without exposing dependency details", async () => {
    const inspector = createSupabaseAchieveBackfillInspector(
      createEnv(),
      async () => {
        throw new Error("unsafe dependency detail")
      },
    )

    expect(await inspector.inspect([first])).toEqual({
      _tag: "failure",
      reason: "read_unavailable",
    })
  })
})
