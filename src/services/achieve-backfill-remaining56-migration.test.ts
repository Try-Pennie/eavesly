import { describe, expect, it } from "vitest"
import sql from "../../docs/sql/psai-245-gate3-remaining56.sql?raw"

describe("PSAI-245 Gate 3 PostgreSQL migration contract", () => {
  it("persists an irreversible per-call claim before grading can occur", () => {
    expect(sql).toContain("status in ('pending', 'attempted', 'completed', 'failed')")
    expect(sql).toContain("where progress.call_id = p_call_id and progress.status = 'pending'")
    expect(sql).toContain("set status = 'attempted', attempted_at = clock_timestamp()")
    expect(sql).not.toMatch(/http|openrouter|slack/i)
  })

  it("requires one exact Gate 2 canary and initializes its exact 56-call complement", () => {
    expect(sql).toContain("cardinality(p_call_ids) <> 57")
    expect(sql).toContain("encode(sha256(convert_to(v_canonical_manifest, 'UTF8')), 'hex')")
    expect(sql).toContain("PSAI-245 remaining-56 manifest digest mismatch")
    expect(sql).toContain("cardinality(v_expected_remaining) <> 56")
    expect(sql).toContain("'psai-245-gate-2-one-call-canary'")
    expect(sql).toContain("where value <> p_completed_canary_call_id")
    expect(sql).toContain("check (call_id <> completed_canary_call_id)")
  })

  it("plain-inserts metadata-free immutable audit rows and never exposes a reset transition", () => {
    expect(sql).toContain("PSAI-245 remaining-56 audit result is immutable")
    expect(sql).toContain("revoke all on function public.eavesly_reject_psai245_remaining56_result_mutation_v1() from public, anon, authenticated, service_role")
    expect(sql).toContain("PSAI-245 remaining-56 call is reserved for audit-only finalization")
    expect(sql).toContain("and new.module_name = 'achieve_welcome_call_qa'")
    expect(sql).toContain("current_setting('eavesly.psai245_remaining_finalize', true) is not distinct from 'on'")
    expect(sql).toContain("set_config('eavesly.psai245_remaining_finalize', 'on', true)")
    expect(sql).toContain("set_config('eavesly.psai245_remaining_finalize', 'off', true)")
    expect(sql).toContain("p_violation_type, false, null, p_processing_time_ms, null, null, null, null, null, null, null")
    expect(sql).not.toMatch(/\bon conflict\b/i)
    expect(sql).not.toMatch(/set status\s*=\s*'pending'/i)
  })
})
