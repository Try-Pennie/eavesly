import { z } from "zod"

export interface MonitoringSnapshot {
  readonly observedAt: Date
  readonly latestCallCompletedAt: Date | null
  readonly latestTranscriptAvailableAt: Date | null
  readonly eventsMissingPlan: number
  readonly completedEventsMissingCallProjection: number
  readonly triggeredPlansMissingResults: number
}

export type StreamHealth =
  | { readonly status: "fresh"; readonly age_seconds: number }
  | { readonly status: "stale"; readonly age_seconds: number | null }
  | { readonly status: "not_scheduled"; readonly age_seconds: number | null }

export interface IngestionHealth {
  readonly status: "healthy" | "degraded"
  readonly schedule: "active" | "not_scheduled"
  readonly checks: {
    readonly call_completed: StreamHealth
    readonly transcript_available: StreamHealth
  }
}

export type PipelineStageHealth =
  | { readonly status: "healthy"; readonly affected: 0 }
  | { readonly status: "degraded"; readonly affected: number }

export interface PipelineHealth {
  readonly status: "healthy" | "degraded"
  readonly checks: {
    readonly resolver_plans: PipelineStageHealth
    readonly call_projection: PipelineStageHealth
    readonly module_results: PipelineStageHealth
  }
}

const RpcTimestampSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value))
const RpcCountSchema = z.coerce.number().int().nonnegative()
const MonitoringSnapshotRowSchema = z.object({
  observed_at: RpcTimestampSchema,
  latest_call_completed_at: RpcTimestampSchema.nullable(),
  latest_transcript_available_at: RpcTimestampSchema.nullable(),
  events_missing_plan: RpcCountSchema,
  completed_events_missing_call_projection: RpcCountSchema,
  triggered_plans_missing_results: RpcCountSchema,
})

/** Parses the untrusted Supabase RPC row before it enters health policy. */
export function parseMonitoringSnapshot(value: unknown): MonitoringSnapshot {
  const parsed = MonitoringSnapshotRowSchema.safeParse(value)
  if (!parsed.success) throw new Error("invalid monitoring snapshot")
  return {
    observedAt: parsed.data.observed_at,
    latestCallCompletedAt: parsed.data.latest_call_completed_at,
    latestTranscriptAvailableAt: parsed.data.latest_transcript_available_at,
    eventsMissingPlan: parsed.data.events_missing_plan,
    completedEventsMissingCallProjection: parsed.data.completed_events_missing_call_projection,
    triggeredPlansMissingResults: parsed.data.triggered_plans_missing_results,
  }
}

const FRESHNESS_MS = 15 * 60_000
const EASTERN_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function easternSchedule(now: Date): { readonly active: boolean; readonly minutesSinceStart: number } {
  const parts = EASTERN_PARTS.formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ""
  const weekday = value("weekday")
  const hour = Number(value("hour"))
  const minute = Number(value("minute"))
  const scheduledDay = weekday !== "Sun"
  const active = scheduledDay && hour >= 8 && hour < 21
  return { active, minutesSinceStart: active ? (hour - 8) * 60 + minute : 0 }
}

function eventAgeSeconds(observedAt: Date, latestAt: Date | null): number | null {
  if (latestAt === null) return null
  return Math.max(0, Math.floor((observedAt.getTime() - latestAt.getTime()) / 1_000))
}

function activeStreamHealth(observedAt: Date, latestAt: Date | null): StreamHealth {
  const ageSeconds = eventAgeSeconds(observedAt, latestAt)
  if (ageSeconds !== null && ageSeconds * 1_000 <= FRESHNESS_MS) {
    return { status: "fresh", age_seconds: ageSeconds }
  }
  return { status: "stale", age_seconds: ageSeconds }
}

function pipelineStage(affected: number): PipelineStageHealth {
  return affected === 0 ? { status: "healthy", affected: 0 } : { status: "degraded", affected }
}

/** Derives a PII-free integrity result for recent event, projection, and evaluation stages. */
export function evaluatePipelineHealth(snapshot: MonitoringSnapshot): PipelineHealth {
  const resolverPlans = pipelineStage(snapshot.eventsMissingPlan)
  const callProjection = pipelineStage(snapshot.completedEventsMissingCallProjection)
  const moduleResults = pipelineStage(snapshot.triggeredPlansMissingResults)
  return {
    status: resolverPlans.status === "healthy" &&
      callProjection.status === "healthy" &&
      moduleResults.status === "healthy"
      ? "healthy"
      : "degraded",
    checks: {
      resolver_plans: resolverPlans,
      call_projection: callProjection,
      module_results: moduleResults,
    },
  }
}

/** Derives a PII-free event-freshness result for Mon-Sat, 08:00-21:00 America/New_York. */
export function evaluateIngestionHealth(snapshot: MonitoringSnapshot): IngestionHealth {
  const schedule = easternSchedule(snapshot.observedAt)
  if (!schedule.active || schedule.minutesSinceStart < 15) {
    return {
      status: "healthy",
      schedule: "not_scheduled",
      checks: {
        call_completed: {
          status: "not_scheduled",
          age_seconds: eventAgeSeconds(snapshot.observedAt, snapshot.latestCallCompletedAt),
        },
        transcript_available: {
          status: "not_scheduled",
          age_seconds: eventAgeSeconds(snapshot.observedAt, snapshot.latestTranscriptAvailableAt),
        },
      },
    }
  }

  const callCompleted = activeStreamHealth(snapshot.observedAt, snapshot.latestCallCompletedAt)
  const transcriptAvailable = activeStreamHealth(snapshot.observedAt, snapshot.latestTranscriptAvailableAt)
  return {
    status: callCompleted.status === "fresh" && transcriptAvailable.status === "fresh" ? "healthy" : "degraded",
    schedule: "active",
    checks: {
      call_completed: callCompleted,
      transcript_available: transcriptAvailable,
    },
  }
}
