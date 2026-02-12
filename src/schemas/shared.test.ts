import { describe, it, expect } from "vitest"
import {
  EvidenceSchema,
  RedFlagHitSchema,
  SectionGapReasonSchema,
  FourPointScale,
  PassFail,
  PassFailNA,
  StepCompletion,
  StepCompletionNA,
} from "./shared"

const validEvidence = {
  speaker: "handling agent",
  quote: "This is a test quote.",
  context: "During the opening of the call.",
  process_step: "Step 1 Agenda Setting" as const,
}

describe("EvidenceSchema", () => {
  it("accepts valid evidence", () => {
    expect(EvidenceSchema.safeParse(validEvidence).success).toBe(true)
  })

  it("rejects missing speaker", () => {
    const { speaker, ...rest } = validEvidence
    expect(EvidenceSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects invalid process_step", () => {
    expect(
      EvidenceSchema.safeParse({ ...validEvidence, process_step: "Step 99" }).success,
    ).toBe(false)
  })

  it("accepts all valid process_step values", () => {
    const steps = [
      "Step 1 Agenda Setting",
      "Step 2 Credit Review",
      "Step 3 Agent Inputs",
      "Step 4 Paydown Projections",
      "Step 5 Loan Offers",
      "Step 6 Debt Resolution",
      "Off-Cycle",
    ]
    for (const step of steps) {
      expect(
        EvidenceSchema.safeParse({ ...validEvidence, process_step: step }).success,
      ).toBe(true)
    }
  })
})

describe("RedFlagHitSchema", () => {
  it("accepts valid red flag hit", () => {
    const result = RedFlagHitSchema.safeParse({
      red_flag: "No credit pull consent",
      evidence: [validEvidence],
    })
    expect(result.success).toBe(true)
  })

  it("accepts all red flag types", () => {
    const flags = [
      "No credit pull consent",
      "Outcome guarantee",
      "Program misrepresentation",
      "High-pressure tactics",
      "Unresolved customer confusion",
    ]
    for (const flag of flags) {
      expect(
        RedFlagHitSchema.safeParse({ red_flag: flag, evidence: [] }).success,
      ).toBe(true)
    }
  })

  it("rejects invalid red flag type", () => {
    expect(
      RedFlagHitSchema.safeParse({ red_flag: "Not a real flag", evidence: [] }).success,
    ).toBe(false)
  })
})

describe("SectionGapReasonSchema", () => {
  it("accepts valid section gap", () => {
    expect(
      SectionGapReasonSchema.safeParse({ section: 3, reason: "Customer ended call" }).success,
    ).toBe(true)
  })

  it("rejects section below 1", () => {
    expect(
      SectionGapReasonSchema.safeParse({ section: 0, reason: "reason" }).success,
    ).toBe(false)
  })

  it("rejects section above 6", () => {
    expect(
      SectionGapReasonSchema.safeParse({ section: 7, reason: "reason" }).success,
    ).toBe(false)
  })
})

describe("enum schemas", () => {
  it("FourPointScale accepts valid values", () => {
    for (const v of ["excellent", "good", "fair", "poor"]) {
      expect(FourPointScale.safeParse(v).success).toBe(true)
    }
  })

  it("FourPointScale rejects invalid value", () => {
    expect(FourPointScale.safeParse("great").success).toBe(false)
  })

  it("PassFail accepts pass and fail", () => {
    expect(PassFail.safeParse("pass").success).toBe(true)
    expect(PassFail.safeParse("fail").success).toBe(true)
    expect(PassFail.safeParse("not_applicable").success).toBe(false)
  })

  it("PassFailNA adds not_applicable", () => {
    expect(PassFailNA.safeParse("not_applicable").success).toBe(true)
    expect(PassFailNA.safeParse("pass").success).toBe(true)
  })

  it("StepCompletion accepts valid values", () => {
    for (const v of ["complete", "partial", "missing"]) {
      expect(StepCompletion.safeParse(v).success).toBe(true)
    }
    expect(StepCompletion.safeParse("not_applicable").success).toBe(false)
  })

  it("StepCompletionNA adds not_applicable", () => {
    expect(StepCompletionNA.safeParse("not_applicable").success).toBe(true)
  })
})
