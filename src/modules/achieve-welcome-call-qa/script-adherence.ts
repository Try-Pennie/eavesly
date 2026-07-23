import type { z } from "zod"
import type { AchieveWelcomeCallQAModelResponseSchema } from "../../schemas/achieve-welcome-call-qa"

type ModelResponse = z.infer<typeof AchieveWelcomeCallQAModelResponseSchema>
type ScriptAdherence = ModelResponse["script_adherence"]

/**
 * Applies the server-owned Achieve script-violation formula. The model grades
 * individual elements and overall adherence; it does not own the final boolean
 * arithmetic used for alerts.
 */
export function finalizeScriptAdherence(
  adherence: ScriptAdherence,
): ScriptAdherence {
  if (!adherence.recording_disclosure_provided) {
    return {
      ...adherence,
      violation: true,
      violation_reason: "Required recording disclosure was missing.",
    }
  }

  if (
    adherence.overall_script_adherence === "minimal" ||
    adherence.overall_script_adherence === "none"
  ) {
    return {
      ...adherence,
      violation: true,
      violation_reason: "Overall script adherence was minimal or none.",
    }
  }

  if (
    !adherence.dedicated_account_deposits_explained &&
    !adherence.settlement_authorizations_explained
  ) {
    return {
      ...adherence,
      violation: true,
      violation_reason:
        "Both dedicated-account deposits and settlement authorizations were missing.",
    }
  }

  return {
    ...adherence,
    violation: false,
    violation_reason: "",
  }
}
