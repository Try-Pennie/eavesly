-- Program Expectations two-call resolver prerequisites.
-- Apply before deploying the matching Worker code.
-- CREATE INDEX CONCURRENTLY must run outside a transaction.

create index concurrently if not exists eavesly_calls_lead_started_at_idx
  on public.eavesly_calls (sfdc_lead_id, started_at desc)
  where sfdc_lead_id is not null and started_at is not null;

create table if not exists public.eavesly_program_expectations_evidence (
  source_call_id text not null,
  sfdc_lead_id text not null,
  source_started_at timestamptz not null,
  source_agent_email text,
  rubric_version text not null,
  evaluator_version text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[a-f0-9]{64}$'),
  model text not null,
  assessment_status text not null check (assessment_status in ('complete', 'partial')),
  assessment_json jsonb not null,
  evaluated_at timestamptz not null default now(),
  primary key (source_call_id, rubric_version, evaluator_version, prompt_sha256, transcript_sha256, model)
);

create index if not exists eavesly_program_expectations_evidence_lead_idx
  on public.eavesly_program_expectations_evidence (sfdc_lead_id, source_started_at desc);

alter table public.eavesly_program_expectations_evidence enable row level security;
revoke all on public.eavesly_program_expectations_evidence from anon, authenticated;
