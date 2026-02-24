import { z } from "zod"

const CollectionMethod = z.enum([
  "agent_asked",
  "customer_volunteered",
  "broad_question",
  "not_collected",
])

const BudgetCategorySchema = z.object({
  collected: z.boolean(),
  how_collected: CollectionMethod,
  evidence: z.string(),
})

const TOTAL_FIELDS = 19
const REQUIRED_FIELDS = 11

export const BudgetInputsSchema = z.object({
  budget_collection_overview: z.object({
    items_collected: z.number().int().min(0).max(TOTAL_FIELDS),
    items_skipped: z.number().int().min(0).max(TOTAL_FIELDS),
    required_items_skipped: z.number().int().min(0).max(REQUIRED_FIELDS),
    budget_compliance_violation: z.boolean(),
  }),
  // Required fields (marked with * in the UI)
  housing_status: BudgetCategorySchema,
  housing: BudgetCategorySchema,
  housing_insurance: BudgetCategorySchema,
  utilities: BudgetCategorySchema,
  phone_internet_tv: BudgetCategorySchema,
  car_payment: BudgetCategorySchema,
  car_insurance: BudgetCategorySchema,
  car_fuel: BudgetCategorySchema,
  food_and_groceries: BudgetCategorySchema,
  medical: BudgetCategorySchema,
  health_and_life_insurance: BudgetCategorySchema,
  // Optional fields
  household: BudgetCategorySchema,
  personal_care: BudgetCategorySchema,
  student_loans: BudgetCategorySchema,
  legal: BudgetCategorySchema,
  alimony_and_child_support: BudgetCategorySchema,
  back_taxes: BudgetCategorySchema,
  dependent_care: BudgetCategorySchema,
  other_debts: BudgetCategorySchema,
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type BudgetInputsResult = z.infer<typeof BudgetInputsSchema>

export const BUDGET_REQUIRED_FIELDS = [
  "housing_status",
  "housing",
  "housing_insurance",
  "utilities",
  "phone_internet_tv",
  "car_payment",
  "car_insurance",
  "car_fuel",
  "food_and_groceries",
  "medical",
  "health_and_life_insurance",
] as const

const BUDGET_OPTIONAL_FIELDS = [
  "household",
  "personal_care",
  "student_loans",
  "legal",
  "alimony_and_child_support",
  "back_taxes",
  "dependent_care",
  "other_debts",
] as const

export const BUDGET_ALL_FIELDS = [
  ...BUDGET_REQUIRED_FIELDS,
  ...BUDGET_OPTIONAL_FIELDS,
] as const
