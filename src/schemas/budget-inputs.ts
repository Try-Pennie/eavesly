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

export const BudgetInputsSchema = z.object({
  budget_collection_overview: z.object({
    items_collected: z.number().int().min(0).max(4),
    items_skipped: z.number().int().min(0).max(4),
    budget_compliance_violation: z.boolean(),
  }),
  housing_payment: BudgetCategorySchema,
  auto_payment: BudgetCategorySchema,
  utilities: BudgetCategorySchema,
  other_debts_expenses: BudgetCategorySchema,
  violation_reason: z.string(),
  key_evidence_quote: z.string(),
})

export type BudgetInputsResult = z.infer<typeof BudgetInputsSchema>
