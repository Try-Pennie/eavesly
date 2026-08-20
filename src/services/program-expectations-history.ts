import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import {
  ProgramExpectationsAssessmentSchema,
  type ProgramExpectationsAssessment,
} from "../schemas/program-expectations"
import { TranscriptAvailableEventSchema } from "../schemas/regal-events"
import type { Bindings } from "../types/env"
import {
  PROGRAM_EXPECTATIONS_EVALUATOR_VERSION,
  PROGRAM_EXPECTATIONS_LOOKBACK_DAYS,
  PROGRAM_EXPECTATIONS_MAX_PRIOR_CALLS,
  PROGRAM_EXPECTATIONS_RUBRIC_VERSION,
  sha256Hex,
  type PriorProgramExpectationCall,
  type PriorProgramExpectationLookup,
} from "../modules/program-expectations/resolver"

const CurrentCallRowSchema = z.object({
  sfdc_lead_id: z.string().min(1).nullable(),
  started_at: z.string().nullable(),
}).strict()

const PriorCallRowsSchema = z.array(z.object({
  call_id: z.string().min(1),
  started_at: z.string().min(1),
  agent_email: z.string().nullable(),
  talk_time: z.number().nonnegative().nullable(),
}).strict())

const QaTranscriptRowsSchema = z.array(z.object({
  call_id: z.string().min(1),
  original_transcript: z.string().max(200_000).nullable(),
  created_at: z.string().min(1),
}).strict())

const LegacyTranscriptRowsSchema = z.array(z.object({
  call_id: z.string().min(1),
  full_transcript: z.string().max(200_000).nullable(),
}).strict())

const EventRowsSchema = z.array(z.object({
  regal_task_id: z.string().min(1),
  payload: z.unknown(),
}).strict())

const CachedEvidenceRowSchema = z.object({
  assessment_json: ProgramExpectationsAssessmentSchema,
}).strict()

type HistoryLookupInput = {
  readonly currentCallId: string
  readonly expectedLeadId: string | undefined
  readonly expectedStartedAt: string
}

/** PE-specific transcript history and immutable evidence persistence. */
export class ProgramExpectationsHistoryService {
  private readonly client: SupabaseClient

  constructor(env: Bindings, client?: SupabaseClient) {
    this.client = client ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  }

  /** Load exact-lead, strictly earlier calls and bounded transcript evidence. */
  async lookup(input: HistoryLookupInput): Promise<PriorProgramExpectationLookup> {
    const currentResponse = await this.client
      .from("eavesly_calls")
      .select("sfdc_lead_id,started_at")
      .eq("call_id", input.currentCallId)
      .limit(1)
      .maybeSingle()

    if (currentResponse.error) return { status: "needs_review", reason: "dependency_failure" }

    const currentParsed = currentResponse.data === null
      ? null
      : CurrentCallRowSchema.safeParse(currentResponse.data)
    if (currentParsed !== null && !currentParsed.success) {
      return { status: "needs_review", reason: "dependency_failure" }
    }

    const storedLeadId = currentParsed?.data.sfdc_lead_id ?? undefined
    if (
      storedLeadId !== undefined
      && input.expectedLeadId !== undefined
      && storedLeadId !== input.expectedLeadId
    ) {
      return { status: "needs_review", reason: "identity_unproven" }
    }
    const leadId = storedLeadId ?? input.expectedLeadId
    if (leadId === undefined) return { status: "needs_review", reason: "identity_unproven" }

    const startedAt = currentParsed?.data.started_at ?? input.expectedStartedAt
    const startedAtMs = Date.parse(startedAt)
    if (!Number.isFinite(startedAtMs)) {
      return { status: "needs_review", reason: "chronology_unproven" }
    }
    const lookbackStart = new Date(
      startedAtMs - PROGRAM_EXPECTATIONS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()

    const priorResponse = await this.client
      .from("eavesly_calls")
      .select("call_id,started_at,agent_email,talk_time")
      .eq("sfdc_lead_id", leadId)
      .neq("call_id", input.currentCallId)
      .lt("started_at", new Date(startedAtMs).toISOString())
      .gte("started_at", lookbackStart)
      .order("started_at", { ascending: false })
      .limit(PROGRAM_EXPECTATIONS_MAX_PRIOR_CALLS)

    if (priorResponse.error) return { status: "needs_review", reason: "dependency_failure" }
    const priorParsed = PriorCallRowsSchema.safeParse(priorResponse.data)
    if (!priorParsed.success) return { status: "needs_review", reason: "dependency_failure" }
    if (priorParsed.data.length === 0) return { status: "none" }

    const priorRows = [...priorParsed.data].sort((left, right) =>
      (right.talk_time ?? 0) - (left.talk_time ?? 0)
      || Date.parse(right.started_at) - Date.parse(left.started_at),
    )
    const callIds = priorRows.map((row) => row.call_id)
    const [eventResponse, qaResponse, legacyResponse] = await Promise.all([
      this.client.from("eavesly_regal_call_events")
        .select("regal_task_id,payload")
        .eq("event_type", "transcript_available")
        .in("regal_task_id", callIds),
      this.client.from("eavesly_transcription_qa")
        .select("call_id,original_transcript,created_at")
        .in("call_id", callIds)
        .order("created_at", { ascending: false }),
      this.client.from("eavesly_transcriptions")
        .select("call_id,full_transcript")
        .in("call_id", callIds),
    ])

    const events = eventResponse.error ? null : EventRowsSchema.safeParse(eventResponse.data)
    const qa = qaResponse.error ? null : QaTranscriptRowsSchema.safeParse(qaResponse.data)
    const legacy = legacyResponse.error ? null : LegacyTranscriptRowsSchema.safeParse(legacyResponse.data)
    if (
      (events !== null && !events.success)
      || (qa !== null && !qa.success)
      || (legacy !== null && !legacy.success)
    ) {
      return { status: "needs_review", reason: "dependency_failure" }
    }

    const eventTranscripts = new Map<string, string>()
    if (events?.success) {
      for (const row of events.data) {
        const parsed = TranscriptAvailableEventSchema.safeParse(row.payload)
        const transcript = parsed.success && parsed.data.transcript_is_truncated !== true
          ? parsed.data.transcript?.trim()
          : undefined
        if (parsed.success && parsed.data.regal_task_id === row.regal_task_id && transcript) {
          eventTranscripts.set(row.regal_task_id, parsed.data.transcript ?? transcript)
        }
      }
    }

    const qaTranscripts = new Map<string, string>()
    if (qa?.success) {
      for (const row of qa.data) {
        if (qaTranscripts.has(row.call_id)) continue
        const transcript = row.original_transcript?.trim()
        if (transcript) qaTranscripts.set(row.call_id, row.original_transcript ?? transcript)
      }
    }

    const legacyTranscripts = new Map<string, string>()
    if (legacy?.success) {
      for (const row of legacy.data) {
        if (legacyTranscripts.has(row.call_id)) continue
        const transcript = row.full_transcript?.trim()
        if (transcript) legacyTranscripts.set(row.call_id, row.full_transcript ?? transcript)
      }
    }

    const calls: PriorProgramExpectationCall[] = []
    for (const row of priorRows) {
      const eventTranscript = eventTranscripts.get(row.call_id)
      const qaTranscript = qaTranscripts.get(row.call_id)
      const legacyTranscript = legacyTranscripts.get(row.call_id)
      if (eventTranscript !== undefined) {
        calls.push({ ...row, transcript: eventTranscript, transcript_source: "regal_event" })
      } else if (qaTranscript !== undefined) {
        calls.push({ ...row, transcript: qaTranscript, transcript_source: "legacy_qa" })
      } else if (legacyTranscript !== undefined) {
        calls.push({ ...row, transcript: legacyTranscript, transcript_source: "legacy_transcription" })
      }
    }

    return {
      status: "ready",
      lead_id: leadId,
      calls,
      total_eligible_calls: priorRows.length,
      unavailable_transcript_count: priorRows.length - calls.length,
    }
  }

  /** Return a version- and transcript-matched cached assessment when present. */
  async loadCachedAssessment(
    call: PriorProgramExpectationCall,
    promptSha256: string,
    model: string,
  ): Promise<ProgramExpectationsAssessment | null> {
    const transcriptSha256 = await sha256Hex(call.transcript)
    const response = await this.client
      .from("eavesly_program_expectations_evidence")
      .select("assessment_json")
      .eq("source_call_id", call.call_id)
      .eq("rubric_version", PROGRAM_EXPECTATIONS_RUBRIC_VERSION)
      .eq("evaluator_version", PROGRAM_EXPECTATIONS_EVALUATOR_VERSION)
      .eq("prompt_sha256", promptSha256)
      .eq("transcript_sha256", transcriptSha256)
      .eq("model", model)
      .limit(1)
      .maybeSingle()

    if (response.error) throw new Error("Program Expectations evidence cache read failed")
    if (response.data === null) return null
    const parsed = CachedEvidenceRowSchema.safeParse(response.data)
    if (!parsed.success) throw new Error("Program Expectations evidence cache row was invalid")
    return parsed.data.assessment_json
  }

  /** Persist immutable transcript-local evidence for audit and later cache hits. */
  async storeAssessment(input: {
    readonly call: PriorProgramExpectationCall
    readonly leadId: string
    readonly assessment: ProgramExpectationsAssessment
    readonly promptSha256: string
    readonly model: string
  }): Promise<void> {
    const transcriptSha256 = await sha256Hex(input.call.transcript)
    const response = await this.client.from("eavesly_program_expectations_evidence").upsert({
      source_call_id: input.call.call_id,
      sfdc_lead_id: input.leadId,
      source_started_at: input.call.started_at,
      source_agent_email: input.call.agent_email,
      rubric_version: PROGRAM_EXPECTATIONS_RUBRIC_VERSION,
      evaluator_version: PROGRAM_EXPECTATIONS_EVALUATOR_VERSION,
      prompt_sha256: input.promptSha256,
      transcript_sha256: transcriptSha256,
      model: input.model,
      assessment_status:
        Object.entries(input.assessment)
          .filter(([key]) => key.endsWith("_covered"))
          .every(([, value]) => value === true)
          ? "complete"
          : "partial",
      assessment_json: input.assessment,
      evaluated_at: new Date().toISOString(),
    }, {
      onConflict: "source_call_id,rubric_version,evaluator_version,prompt_sha256,transcript_sha256,model",
      ignoreDuplicates: true,
    })

    if (response.error) throw new Error("Program Expectations evidence cache write failed")
  }
}
