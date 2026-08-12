import { describe, expect, it } from "vitest"
import sql from "../../docs/sql/psai-245-gate2-canary.sql?raw"

describe("PSAI-245 Gate 2 PostgreSQL migration contract", () => {
  it("serializes the final 57-ID conflict check and plain insert without an LLM transaction", () => {
    const lock = sql.indexOf(
      "lock table public.eavesly_module_results in share row exclusive mode",
    )
    const finalKnownCheck = sql.indexOf("select count(distinct calls.call_id)::integer")
    const insert = sql.indexOf("insert into public.eavesly_module_results")

    expect(lock).toBeGreaterThan(0)
    expect(finalKnownCheck).toBeGreaterThan(lock)
    expect(insert).toBeGreaterThan(finalKnownCheck)
    expect(sql).not.toMatch(/\bon conflict\b/i)
    expect(sql).not.toMatch(/http|openrouter|workflow|slack/i)
  })

  it("allows only one member canary per approved digest and makes its row immutable", () => {
    expect(sql).toContain(
      "create unique index if not exists eavesly_module_results_psai245_canary_digest_uidx",
    )
    expect(sql).toContain("(result_json #>> '{backfill,approved_digest}')")
    expect(sql).toContain("(result_json #>> '{backfill,canary_id}')")
    expect(sql).toContain("before update or delete on public.eavesly_module_results")
    expect(sql).toContain("for each row\nwhen (")
    expect(sql).toContain("old.module_name = 'achieve_welcome_call_qa'")
    expect(sql).toContain(
      "old.result_json #>> '{backfill,approved_digest}' = '01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e'",
    )
    expect(sql).toContain("PSAI-245 audit canary result is immutable")
  })

  it("keeps atomic finalization service-role-only and pins exact approval provenance", () => {
    expect(sql).toContain("auth.role() is distinct from 'service_role'")
    expect(sql).toContain("from public, anon, authenticated")
    expect(sql).toContain("to service_role")
    expect(sql.match(/01e4a469234e5271bc28c3f92022fd929e073b1d4926a162067d96ceddb2b86e/g)?.length)
      .toBeGreaterThanOrEqual(2)
    expect(sql).toContain("p_result_json #> '{backfill,audit_only}' is distinct from 'true'::jsonb")
    expect(sql).toContain("cardinality(p_call_ids) <> 57")
    expect(sql).toContain("not (p_canary_call_id = any(p_call_ids))")
    expect(sql).toContain("false,\n      null,\n      p_processing_time_ms")
  })
})
