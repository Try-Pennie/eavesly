export const MODULE_NAMES = {
  FULL_QA: "full_qa",
  BUDGET_INPUTS: "budget_inputs",
  WARM_TRANSFER: "warm_transfer",
  LITIGATION_CHECK: "litigation_check",
} as const

export const VIOLATION_TYPES = {
  MANAGER_ESCALATION: "manager_escalation",
  BUDGET_COMPLIANCE: "budget_compliance",
  WARM_TRANSFER: "warm_transfer",
  LITIGATION_CHECK: "litigation_check",
} as const

type ModuleName = (typeof MODULE_NAMES)[keyof typeof MODULE_NAMES]
type ViolationType = (typeof VIOLATION_TYPES)[keyof typeof VIOLATION_TYPES]
