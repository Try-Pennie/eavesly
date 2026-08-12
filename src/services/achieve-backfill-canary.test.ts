import { describe, expect, it } from "vitest"
import { AchieveBackfillCanaryRequestSchema } from "../schemas/achieve-backfill-canary"
import { AchieveBackfillCallIdSchema } from "../schemas/achieve-backfill-dry-run"
import type { ModuleResult } from "../modules/types"
import {
  runAchieveBackfillCanary,
  type AchieveBackfillCanaryDependencies,
  type AchieveBackfillExistingResult,
} from "./achieve-backfill-canary"
import { sha256CanonicalJson } from "./canonical-json"

const TEST_DIGEST = "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8"
const callIds = Array.from(
  { length: 57 },
  (_, index) => AchieveBackfillCallIdSchema.parse(
    `approved-call-${String(index + 1).padStart(2, "0")}`,
  ),
)

function command(canaryCallId: string = callIds[0]) {
  return AchieveBackfillCanaryRequestSchema.parse({
    manifest: {
      representation_version: "psai-245-achieve-backfill-manifest-v1",
      gate: "gate_1_dry_run",
      module_name: "achieve_welcome_call_qa",
      snapshot: {
        cutoff: "2026-08-11T16:21:44.777859Z",
        funnel_counts: [378, 101, 89, 88, 65, 57],
      },
      candidate_count: 57,
      candidates: callIds.map((call_id) => ({
        call_id,
        reason: "approved_frozen_cohort",
        status: "eligible",
      })),
    },
    digest: {
      algorithm: "SHA-256",
      canonicalization: "eavesly-canonical-json-v1",
      value: TEST_DIGEST,
    },
    canary_call_id: canaryCallId,
  })
}

const gradedResult: ModuleResult = {
  module_name: "achieve_welcome_call_qa",
  result: { grading: "categorical" },
  has_violation: true,
  violation_type: "achieve_welcome_call_violation",
  processing_time_ms: 12,
}

function dependencies(): AchieveBackfillCanaryDependencies & {
  readonly gradedTranscripts: Array<string>
  readonly inserts: Array<unknown>
} {
  const gradedTranscripts: Array<string> = []
  const inserts: Array<unknown> = []
  return {
    gradedTranscripts,
    inserts,
    inspect: async () => ({
      _tag: "success",
      knownCallIds: callIds,
      existingResults: [],
    }),
    loadTranscript: async () => ({ _tag: "success", transcript: "private transcript" }),
    grade: async (_callId, transcript) => {
      gradedTranscripts.push(transcript)
      return { _tag: "success", result: gradedResult }
    },
    finalize: async (_callIds, record) => {
      inserts.push(record)
      return { _tag: "inserted" }
    },
  }
}

function exactExisting(callId = callIds[0]): AchieveBackfillExistingResult {
  return {
    callId,
    provenance: {
      auditOnly: true,
      approvedDigest: TEST_DIGEST,
      batchId: "psai-245-gate-2-approved-manifest",
      canaryId: "psai-245-gate-2-one-call-canary",
      canaryCallId: callIds[0],
      manifestVersion: "psai-245-achieve-backfill-manifest-v1",
      snapshotCutoff: "2026-08-11T16:21:44.777859Z",
    },
  }
}

async function commandWithOwnApproval(mutate: (body: ReturnType<typeof command>) => void) {
  const body = command()
  mutate(body)
  const digest = await sha256CanonicalJson(body.manifest)
  if (digest._tag !== "success") throw new Error("test manifest was not canonical")
  return {
    command: AchieveBackfillCanaryRequestSchema.parse({
      ...body,
      digest: { ...body.digest, value: digest.value },
    }),
    approvedDigest: digest.value,
  }
}

describe("PSAI-245 Gate 2 one-call canary", () => {
  it("grades and insert-only persists exactly the selected approved candidate", async () => {
    const deps = dependencies()

    const result = await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )

    expect(result).toEqual({
      _tag: "completed",
      callId: callIds[0],
      approvedDigest: TEST_DIGEST,
    })
    expect(deps.gradedTranscripts).toEqual(["private transcript"])
    expect(deps.inserts).toEqual([{
      callId: callIds[0],
      moduleResult: {
        ...gradedResult,
        result: {
          grading: "categorical",
          backfill: {
            audit_only: true,
            approved_digest: TEST_DIGEST,
            batch_id: "psai-245-gate-2-approved-manifest",
            canary_id: "psai-245-gate-2-one-call-canary",
            canary_call_id: callIds[0],
            manifest_version: "psai-245-achieve-backfill-manifest-v1",
            snapshot_cutoff: "2026-08-11T16:21:44.777859Z",
          },
        },
      },
      alertSent: false,
    }])
  })

  it("rejects an unapproved digest and a manifest tampered after approval before reads", async () => {
    const wrongDigestDeps = dependencies()
    const wrongDigest = command()
    wrongDigest.digest.value = "0".repeat(64)

    expect(await runAchieveBackfillCanary(
      wrongDigest,
      wrongDigestDeps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({ _tag: "rejected", reason: "unapproved_digest", callIds: [] })

    const tamperedDeps = dependencies()
    const tampered = command()
    tampered.manifest.candidates[0].call_id = AchieveBackfillCallIdSchema.parse("tampered-approved-call")
    expect(await runAchieveBackfillCanary(
      tampered,
      tamperedDeps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({ _tag: "rejected", reason: "manifest_digest_mismatch", callIds: [] })
    expect(wrongDigestDeps.inserts).toEqual([])
    expect(tamperedDeps.inserts).toEqual([])
  })

  it("rejects a canary that is not a member of the full approved manifest", async () => {
    const deps = dependencies()
    const result = await runAchieveBackfillCanary(
      command("outside-approved-cohort"),
      deps,
      { approvedDigest: TEST_DIGEST },
    )

    expect(result).toEqual({
      _tag: "rejected",
      reason: "canary_not_in_manifest",
      callIds: ["outside-approved-cohort"],
    })
    expect(deps.gradedTranscripts).toEqual([])
  })

  it("fails closed when any of the 57 approved candidates is no longer known", async () => {
    const deps = dependencies()
    deps.inspect = async () => ({
      _tag: "success",
      knownCallIds: callIds.slice(1),
      existingResults: [],
    })

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "rejected",
      reason: "unknown_call_ids",
      callIds: [callIds[0]],
    })
    expect(deps.gradedTranscripts).toEqual([])
  })

  it("fails the entire command for an ordinary result anywhere in the 57", async () => {
    const deps = dependencies()
    deps.inspect = async () => ({
      _tag: "success",
      knownCallIds: callIds,
      existingResults: [{
        callId: callIds[31],
        provenance: {
          auditOnly: false,
          approvedDigest: null,
          batchId: null,
          canaryId: null,
          canaryCallId: null,
          manifestVersion: null,
          snapshotCutoff: null,
        },
      }],
    })

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "rejected",
      reason: "ordinary_results_exist",
      callIds: [callIds[31]],
    })
    expect(deps.gradedTranscripts).toEqual([])
  })

  it("fails closed for audit-only rows with different provenance", async () => {
    const deps = dependencies()
    const existing = exactExisting()
    const different: AchieveBackfillExistingResult = {
      ...existing,
      provenance: { ...existing.provenance, approvedDigest: "f".repeat(64) },
    }
    deps.inspect = async () => ({
      _tag: "success",
      knownCallIds: callIds,
      existingResults: [different],
    })

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "rejected",
      reason: "different_audit_provenance",
      callIds: [callIds[0]],
    })
    expect(deps.gradedTranscripts).toEqual([])
  })

  it("returns already_completed for an exact retry without loading a transcript or invoking the LLM", async () => {
    const deps = dependencies()
    let transcriptLoads = 0
    deps.inspect = async () => ({
      _tag: "success",
      knownCallIds: callIds,
      existingResults: [exactExisting()],
    })
    deps.loadTranscript = async () => {
      transcriptLoads += 1
      return { _tag: "success", transcript: "must not load" }
    }

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "already_completed",
      callId: callIds[0],
      approvedDigest: TEST_DIGEST,
    })
    expect(transcriptLoads).toBe(0)
    expect(deps.gradedTranscripts).toEqual([])
    expect(deps.inserts).toEqual([])
  })

  it("maps an atomically finalized same-canary race to already_completed", async () => {
    const deps = dependencies()
    deps.finalize = async (_callIds, record) => {
      deps.inserts.push(record)
      return { _tag: "already_completed" }
    }

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "already_completed",
      callId: callIds[0],
      approvedDigest: TEST_DIGEST,
    })
    expect(deps.inserts).toHaveLength(1)
  })

  it("honors the atomic final 57-ID conflict check after the LLM completes", async () => {
    const deps = dependencies()
    let finalizedCandidateCount = 0
    deps.finalize = async (finalCallIds) => {
      finalizedCandidateCount = finalCallIds.length
      return { _tag: "rejected", reason: "ordinary_results_exist" }
    }

    expect(await runAchieveBackfillCanary(
      command(),
      deps,
      { approvedDigest: TEST_DIGEST },
    )).toEqual({
      _tag: "rejected",
      reason: "ordinary_results_exist",
      callIds: [],
    })
    expect(deps.gradedTranscripts).toEqual(["private transcript"])
    expect(finalizedCandidateCount).toBe(57)
  })

  it("requires sorted unique Gate 1 candidates even under a self-consistent test approval", async () => {
    const duplicate = await commandWithOwnApproval((body) => {
      body.manifest.candidates[56].call_id = body.manifest.candidates[0].call_id
    })
    expect(await runAchieveBackfillCanary(
      duplicate.command,
      dependencies(),
      { approvedDigest: duplicate.approvedDigest },
    )).toEqual({
      _tag: "rejected",
      reason: "duplicate_call_ids",
      callIds: [callIds[0]],
    })

    const unsorted = await commandWithOwnApproval((body) => {
      body.manifest.candidates.reverse()
    })
    expect(await runAchieveBackfillCanary(
      unsorted.command,
      dependencies(),
      { approvedDigest: unsorted.approvedDigest },
    )).toEqual({ _tag: "rejected", reason: "unsorted_call_ids", callIds: [] })
  })
})
