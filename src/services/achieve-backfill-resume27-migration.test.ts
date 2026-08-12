import { describe, expect, it } from "vitest"
import sql from "../../docs/sql/psai-245-gate3-resume27.sql?raw"

describe("PSAI-245 resume-27 PostgreSQL migration contract", () => {
  it("is additive and leaves the Gate 3 rows, functions, and trigger in place", () => {
    expect(sql).toContain("create table if not exists public.eavesly_psai245_resume27_authorization")
    expect(sql).not.toMatch(/drop\s+(table|trigger|function)/i)
    expect(sql).not.toMatch(/create\s+(or replace\s+)?trigger/i)
    expect(sql).not.toMatch(/set status\s*=\s*'pending'/i)
    expect(sql).not.toMatch(/delete from public\.eavesly_(psai245_remaining56_progress|module_results)/i)
  })

  it("derives and verifies the exact persisted production state before authorization", () => {
    expect(sql).toContain("v_completed_count <> 28")
    expect(sql).toContain("v_pending_count <> 27")
    expect(sql).toContain("v_attempted_count <> 0")
    expect(sql).toContain("v_failed_ordinal <> 30")
    expect(sql).toContain("v_failed_reason is distinct from 'grading_unavailable'")
    expect(sql).toContain("v_actual_fingerprint := encode(sha256(convert_to(v_state_canonical, 'UTF8')), 'hex')")
    expect(sql).toContain("v_exact_gate3_result_count <> 28")
    expect(sql).toContain("v_gate3_capability_result_count <> 28")
    expect(sql).toContain("r.alert_sent is false and r.alert_sent_at is null")
    expect(sql).toContain("r.agent_email is null and r.contact_name is null and r.contact_phone is null")
  })

  it("requires the exact metadata-free Gate 2 canary and enabled Gate 3 guard trigger", () => {
    expect(sql).toContain("v_exact_canary_count <> 1")
    expect(sql).toContain("'psai-245-gate-2-one-call-canary'")
    expect(sql).toContain("t.tgenabled = 'O'")
    expect(sql).toContain("t.tgtype = 31")
    expect(sql).toContain("t.tgname = 'eavesly_module_results_psai245_remaining56_guard'")
    expect(sql).toContain("function_namespace.nspname = 'public'")
    expect(sql).toContain("function_definition.proname = 'eavesly_reject_psai245_remaining56_result_mutation_v1'")
  })

  it("disables only the superseded Gate 3 claim RPC for service-role callers", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.eavesly_claim_achieve_backfill_remaining56_v1\(\s*text,text,text\s*\) from service_role/i,
    )
    expect(sql).not.toMatch(/revoke execute on function public\.eavesly_(finalize|fail)_achieve_backfill_remaining56_v1/i)
  })

  it("locks and claims only the lowest unfinished pending ordinal after 30", () => {
    expect(sql).toContain("order by progress.manifest_ordinal")
    expect(sql).toContain("for update")
    expect(sql).toContain("progress.status <> 'completed'")
    expect(sql).toContain("v_lowest_call_id is distinct from p_call_id")
    expect(sql).toContain("v_lowest_status is distinct from 'pending'")
    expect(sql).toContain("set status = 'attempted', attempted_at = clock_timestamp()")
    expect(sql).not.toMatch(/http|openrouter|slack/i)
  })
})
