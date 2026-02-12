import { z } from "zod"

export const EvidenceSchema = z.object({
  speaker: z.string(),
  quote: z.string(),
  context: z.string(),
  process_step: z.enum([
    "Step 1 Agenda Setting",
    "Step 2 Credit Review",
    "Step 3 Agent Inputs",
    "Step 4 Paydown Projections",
    "Step 5 Loan Offers",
    "Step 6 Debt Resolution",
    "Off-Cycle",
  ]),
})

export const RedFlagHitSchema = z.object({
  red_flag: z.enum([
    "No credit pull consent",
    "Outcome guarantee",
    "Program misrepresentation",
    "High-pressure tactics",
    "Unresolved customer confusion",
  ]),
  evidence: z.array(EvidenceSchema),
})

export const SectionGapReasonSchema = z.object({
  section: z.number().int().min(1).max(6),
  reason: z.string(),
})

export const FourPointScale = z.enum(["excellent", "good", "fair", "poor"])
export const PassFail = z.enum(["pass", "fail"])
export const PassFailNA = z.enum(["pass", "fail", "not_applicable"])
export const StepCompletion = z.enum(["complete", "partial", "missing"])
export const StepCompletionNA = z.enum(["complete", "partial", "missing", "not_applicable"])
