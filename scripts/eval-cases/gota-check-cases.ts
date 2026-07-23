// Hand-written, PII-free regression cases for the Achieve GOTA prompt.
// Cases cover the current vF 7.22.26 Green/FDR and Red/Turnbull scripts,
// historical packet behavior that remains visible in old calls, and the alert
// boundary: signing completed on this call without a guided walkthrough.

import type { GotaCheckResult } from "../../src/schemas/gota-check"

type GotaType = GotaCheckResult["gota_type"]

type BeatKey =
  | "fee_structure_beat_covered"
  | "cancellation_rights_beat_covered"
  | "do_not_sign_page_beat_covered"
  | "banking_readback_beat_covered"
  | "ssn_verification_beat_covered"
  | "wc_transfer_brief_beat_covered"

/** One labeled, synthetic GOTA transcript and its robust expected outcomes. */
export interface GotaEvalCase {
  readonly name: string
  readonly description: string
  readonly transcript: string
  readonly expect: {
    readonly enrollment_completed: boolean
    readonly gota_conducted: boolean
    readonly gota_type?: GotaType
    readonly violation: boolean
    readonly wc_transfer_occurred?: boolean
    readonly beats?: Partial<Record<BeatKey, boolean>>
  }
}

const HANDOFF = [
  "[handling agent]: That's every signature complete. I'm putting you on hold while I bring in the welcome team.",
  "[handling agent]: Hi Jordan, I have Maria for you. Her first deposit is August 14th and her goal is to be debt-free before buying a home.",
  "[transfer agent]: Thanks, I have it. Hi Maria, welcome to Freedom Debt Relief.",
  "[contact]: Hi, thank you.",
]

const GREEN_CURRENT = [
  "[handling agent]: Maria, open the Contract Signing Request email, select Review Documents, agree to electronic business, and click Continue. I'll guide you through every page and signature.",
  "[contact]: I have DocuSign open.",
  "[handling agent]: On pages 2 and 3, confirm the $18,000 enrolled debt and your $240 deposit every two weeks starting August 14th. FDR's fee is performance-based: nothing is earned until a debt is negotiated, you approve it, and a payment is made. Initial those pages.",
  "[contact]: Both initialed.",
  "[handling agent]: Page 15 is the agreement signature. It confirms we reviewed this together. You can cancel anytime, and you also have three business days to change your mind. Click Sign.",
  "[contact]: Signed.",
  "[handling agent]: Page 17 is the Spinwheel authorization, which keeps enrolled balances current from creditor reporting. Sign there, then verify the creditor list on page 18 and initial it.",
  "[contact]: Done.",
  "[handling agent]: On page 20, verify both your Social Security number and date of birth before signing the Authorization to Communicate.",
  "[contact]: They're correct and I signed.",
  "[handling agent]: Page 24 is lawsuit representation. Sign it, then page 28 is the Debt Relief Provider Disclosure Statement; sign to confirm you received it.",
  "[contact]: Done with both.",
  "[handling agent]: Page 29 opens your FDIC-insured CFT Pay account. The $9.95 setup and $9.95 monthly fees are already built into your deposit plan. Sign that page.",
  "[contact]: Signed.",
  "[handling agent]: On page 30, read the routing and account numbers back to me so I can verify them.",
  "[contact]: Routing is 021000021 and account ends in 4321.",
  "[handling agent]: Those match. Sign the banking authorization. The limited Power of Attorney is the last signature; it lets the named partner law firm handle debt matters for you and can be revoked in writing. Sign, then click Finish.",
  "[contact]: I signed it and clicked Finish. It says completed.",
  ...HANDOFF,
].join("\n")

const RED_CURRENT = [
  "[handling agent]: Open the Contract Signing Request and click Review Documents. This is the Turnbull Law Group packet, and I'll explain each section while you sign.",
  "[contact]: It's open.",
  "[handling agent]: Page 3 confirms your $22,000 enrolled debt and $350 monthly deposit. Sign by your numbers. Pages 4 through 6 explain that Turnbull's attorneys and negotiators represent you and litigation defense is built in.",
  "[contact]: I signed and scrolled to page 7.",
  "[handling agent]: Pages 7 through 9 cover Turnbull's performance fee. Nothing is earned until a debt is negotiated, you approve it, and a payment is made. The fee is already in your deposit plan. Sign the footers.",
  "[contact]: Done.",
  "[handling agent]: Page 16 is the main agreement signature. You can cancel anytime and have five business days to change your mind. Sign there.",
  "[contact]: Signed.",
  "[handling agent]: Page 18 is your cancellation notice. Sign only the footer like the other pages; leave the middle cancellation signature line blank because that line is only used to cancel.",
  "[contact]: Footer signed and the middle line is blank.",
  "[handling agent]: Review your creditor list and budget on pages 19 through 21, then sign the deposit confirmation and cash-flow acknowledgment.",
  "[contact]: Both signed.",
  "[handling agent]: The CFT Pay account costs $9.95 to set up and $9.95 monthly, already included. Sign it. On the banking page, read your routing and account numbers back to me.",
  "[contact]: Routing is 021000021 and the account ends in 9876.",
  "[handling agent]: Verified. Sign that. Page 40 is Spinwheel; it keeps balances current from creditor reporting. Sign it too.",
  "[contact]: Done.",
  "[handling agent]: On the Power of Attorney and Authorization to Communicate, verify your Social Security number and date of birth, sign both, and click Finish.",
  "[contact]: The information is right. Both are signed and Finish says complete.",
  ...HANDOFF,
].join("\n")

/** PII-free regression set spanning current, legacy, and non-compliant GOTA calls. */
export const GOTA_EVAL_CASES: ReadonlyArray<GotaEvalCase> = [
  {
    name: "green-vf-7.22.26-compliant",
    description: "Current FDR packet: guided signing, Spinwheel, partner-law-firm POA, and no cancellation-notice page.",
    transcript: GREEN_CURRENT,
    expect: {
      enrollment_completed: true,
      gota_conducted: true,
      gota_type: "fdr_green",
      violation: false,
      wc_transfer_occurred: true,
      beats: {
        fee_structure_beat_covered: true,
        cancellation_rights_beat_covered: true,
        do_not_sign_page_beat_covered: false,
        banking_readback_beat_covered: true,
        ssn_verification_beat_covered: true,
        wc_transfer_brief_beat_covered: true,
      },
    },
  },
  {
    name: "red-vf-7.22.26-compliant",
    description: "Current Turnbull packet: cancellation footer signed while its middle cancellation line stays blank.",
    transcript: RED_CURRENT,
    expect: {
      enrollment_completed: true,
      gota_conducted: true,
      gota_type: "turnbull_red",
      violation: false,
      wc_transfer_occurred: true,
      beats: {
        fee_structure_beat_covered: true,
        cancellation_rights_beat_covered: true,
        do_not_sign_page_beat_covered: true,
        banking_readback_beat_covered: true,
        ssn_verification_beat_covered: true,
        wc_transfer_brief_beat_covered: true,
      },
    },
  },
  {
    name: "green-legacy-cancellation-pages",
    description: "Older FDR packet: client initials receipt of cancellation pages but does not sign the cancellation line.",
    transcript: [
      "[handling agent]: Open the FDR Contract Signing Request. I'll guide you through the agreement page by page and tell you where to initial or sign.",
      "[contact]: Ready.",
      "[handling agent]: Pages 2 and 3 show your debt, monthly deposit, and schedule. FDR earns nothing until it negotiates a debt, you approve the settlement, and a payment is made. Initial both.",
      "[contact]: Initialed.",
      "[handling agent]: Review the agreement sections with me as we scroll. On page 13, sign the agreement. You can cancel anytime and have three business days to change your mind.",
      "[contact]: Signed.",
      "[handling agent]: Verify the creditor list, sign the Direct Debit Authorization, and verify your Social Security number on the Authorization to Communicate before signing.",
      "[contact]: Done; my SSN is correct.",
      "[handling agent]: Sign the budget, lawsuit representation, dedicated account, banking authorization, AFCC disclosure, and limited Power of Attorney as we reach each one.",
      "[contact]: Everything is signed.",
      "[handling agent]: These last two pages are cancellation notices. Do not sign the cancellation lines — signing them would cancel. Initial only at the bottom to acknowledge receipt, then click Finish.",
      "[contact]: I initialed, did not sign the cancellation lines, and Finish says complete.",
    ].join("\n"),
    expect: {
      enrollment_completed: true,
      gota_conducted: true,
      gota_type: "fdr_green",
      violation: false,
      beats: {
        do_not_sign_page_beat_covered: true,
        ssn_verification_beat_covered: true,
      },
    },
  },
  {
    name: "cold-signing-violation",
    description: "Agent sends DocuSign and leaves the client to click through alone; completion without GOTA must alert.",
    transcript: [
      "[handling agent]: I just emailed the Contract Signing Request. Open it, click Review Documents, and sign everywhere DocuSign points you. You can do it on your own; tell me when you're finished.",
      "[contact]: Okay, give me a minute.",
      "[handling agent]: Sure, I'm putting myself on mute.",
      "[contact]: It says all required fields are complete. I clicked Finish.",
      "[handling agent]: Great, I see the signed packet came through. Let me transfer you to the welcome team.",
      "[transfer agent]: Hi, welcome to Freedom Debt Relief.",
    ].join("\n"),
    expect: {
      enrollment_completed: true,
      gota_conducted: false,
      gota_type: "unknown",
      violation: true,
      wc_transfer_occurred: true,
    },
  },
  {
    name: "psc-readthrough-is-not-gota",
    description: "Recorded compliance disclosure plus unguided signing is not a page-by-page walkthrough.",
    transcript: [
      "[handling agent]: This portion is recorded. Debt resolution may adversely affect your credit and creditors may continue collection activity. You control your dedicated account and may cancel at any time.",
      "[contact]: I understand.",
      "[handling agent]: That completes the recorded disclosure. I sent your DocuSign; click every yellow button and Finish when you're done.",
      "[contact]: I signed it all and clicked Finish.",
      "[handling agent]: I see the completed agreement. Hold while I connect the welcome call.",
    ].join("\n"),
    expect: {
      enrollment_completed: true,
      gota_conducted: false,
      gota_type: "unknown",
      violation: true,
      wc_transfer_occurred: true,
    },
  },
  {
    name: "signing-deferred-no-violation",
    description: "Client asks to review later; no same-call completion means no GOTA alert.",
    transcript: [
      "[handling agent]: I sent the agreement and can guide you through the signatures now.",
      "[contact]: I don't want to sign today. I need to read it and talk to my spouse first.",
      "[handling agent]: Of course. Nothing has been signed, so I'll schedule a follow-up for tomorrow.",
      "[contact]: That works.",
    ].join("\n"),
    expect: {
      enrollment_completed: false,
      gota_conducted: false,
      gota_type: "unknown",
      violation: false,
      wc_transfer_occurred: false,
    },
  },
]
