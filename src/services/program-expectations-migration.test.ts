import { describe, expect, it } from "vitest"
import sql from "../../docs/sql/program-expectations-two-call-resolver.sql?raw"

describe("Program Expectations two-call resolver migration", () => {
  it("adds the exact-lead chronology index and immutable evidence key", () => {
    expect(sql).toContain("create index concurrently if not exists eavesly_calls_lead_started_at_idx")
    expect(sql).toContain("eavesly_calls (sfdc_lead_id, started_at desc)")
    expect(sql).toContain("primary key (source_call_id, rubric_version, evaluator_version, prompt_sha256, transcript_sha256, model)")
  })

  it("keeps transcript evidence service-role only", () => {
    expect(sql).toContain("enable row level security")
    expect(sql).toContain("revoke all on public.eavesly_program_expectations_evidence from anon, authenticated")
  })
})
