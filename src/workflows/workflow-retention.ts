type WorkflowRetention = Readonly<
  Required<NonNullable<WorkflowInstanceCreateOptions["retention"]>>
>

const PRODUCTION_RETENTION = {
  successRetention: "7 days",
  errorRetention: "14 days",
} as const satisfies WorkflowRetention

const NON_PRODUCTION_RETENTION = {
  successRetention: "1 day",
  errorRetention: "3 days",
} as const satisfies WorkflowRetention

/**
 * Selects the instance-retention window for the configured deployment environment.
 * Unknown local/test environment names use the lower-cost non-production policy.
 */
export function workflowRetentionForEnvironment(environment: string): WorkflowRetention {
  return environment === "production" ? PRODUCTION_RETENTION : NON_PRODUCTION_RETENTION
}
