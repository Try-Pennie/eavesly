import { describe, it, expect } from "vitest"
import { BudgetInputsSchema } from "./budget-inputs"
import passFixture from "../../test/fixtures/responses/budget-inputs-pass.json"
import violationFixture from "../../test/fixtures/responses/budget-inputs-violation.json"

describe("BudgetInputsSchema", () => {
  it("validates pass fixture", () => {
    const result = BudgetInputsSchema.safeParse(passFixture)
    expect(result.success).toBe(true)
  })

  it("validates violation fixture", () => {
    const result = BudgetInputsSchema.safeParse(violationFixture)
    expect(result.success).toBe(true)
  })

  it("pass fixture has no violation", () => {
    const result = BudgetInputsSchema.parse(passFixture)
    expect(result.budget_collection_overview.budget_compliance_violation).toBe(false)
    expect(result.budget_collection_overview.items_collected).toBe(4)
  })

  it("violation fixture has violation true", () => {
    const result = BudgetInputsSchema.parse(violationFixture)
    expect(result.budget_collection_overview.budget_compliance_violation).toBe(true)
    expect(result.budget_collection_overview.items_skipped).toBe(2)
  })

  it("rejects items_collected above 4", () => {
    const modified = {
      ...passFixture,
      budget_collection_overview: {
        ...passFixture.budget_collection_overview,
        items_collected: 5,
      },
    }
    expect(BudgetInputsSchema.safeParse(modified).success).toBe(false)
  })

  it("rejects items_collected below 0", () => {
    const modified = {
      ...passFixture,
      budget_collection_overview: {
        ...passFixture.budget_collection_overview,
        items_collected: -1,
      },
    }
    expect(BudgetInputsSchema.safeParse(modified).success).toBe(false)
  })

  it("accepts items_collected at boundary values 0 and 4", () => {
    for (const val of [0, 4]) {
      const modified = {
        ...passFixture,
        budget_collection_overview: {
          ...passFixture.budget_collection_overview,
          items_collected: val,
        },
      }
      expect(BudgetInputsSchema.safeParse(modified).success).toBe(true)
    }
  })

  it("rejects invalid how_collected enum", () => {
    const modified = {
      ...passFixture,
      housing_payment: {
        ...passFixture.housing_payment,
        how_collected: "telepathy",
      },
    }
    expect(BudgetInputsSchema.safeParse(modified).success).toBe(false)
  })

  it("accepts all valid how_collected values", () => {
    for (const method of ["agent_asked", "customer_volunteered", "broad_question", "not_collected"]) {
      const modified = {
        ...passFixture,
        housing_payment: {
          ...passFixture.housing_payment,
          how_collected: method,
        },
      }
      expect(BudgetInputsSchema.safeParse(modified).success).toBe(true)
    }
  })

  it("rejects missing budget_collection_overview", () => {
    const { budget_collection_overview, ...rest } = passFixture
    expect(BudgetInputsSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects missing budget category", () => {
    const { housing_payment, ...rest } = passFixture
    expect(BudgetInputsSchema.safeParse(rest).success).toBe(false)
  })
})
