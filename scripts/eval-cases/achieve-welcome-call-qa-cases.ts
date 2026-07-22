// Labeled eval set for the achieve-welcome-call-qa module.
//
// Transcripts are hand-written but use the production speaker labels
// ("[handling agent]:", "[transfer agent]:", "[contact]:") so each case runs
// through the REAL segmentWelcomeCall() boundary logic before any LLM call —
// the eval exercises the same pipeline production does.
//
// Two kinds of cases:
//   1. Segmentation cases (expect.segment = {...}): deterministic, no LLM.
//      They pin down skip_reason behavior for mis-routes and failed handoffs.
//   2. Graded cases (expect.grading = {...}): the segment is sent to the model
//      with the production system prompt + preamble, and we score the fields
//      listed. Only fields present in `expect.grading` are scored, so a case
//      can assert the robust signals (violation, a specific missing element)
//      without forcing brittle full-checklist agreement.
//
// The compliant transcript is assembled from named blocks so variant cases can
// omit exactly one script element and assert the model notices.

import type { AchieveWelcomeCallQASchema } from "../../src/schemas/achieve-welcome-call-qa"
import type { z } from "zod"
import type { SegmentSkipReason } from "../../src/modules/achieve-welcome-call-qa/segment"

type Analysis = z.infer<typeof AchieveWelcomeCallQASchema>
type ScriptAdherence = Analysis["script_adherence"]
type OverallAdherence = ScriptAdherence["overall_script_adherence"]

export type ElementKey =
  | "greeting_and_identity_completed"
  | "recording_disclosure_provided"
  | "company_credibility_covered"
  | "call_agenda_provided"
  | "dedicated_account_deposits_explained"
  | "creditor_negotiation_explained"
  | "settlement_authorizations_explained"
  | "dashboard_account_setup_covered"
  | "tools_and_resources_covered"
  | "closing_and_support_provided"

export interface EvalCase {
  name: string
  description: string
  transcript: string
  expect: {
    /** Deterministic segmentation assertion — checked once, no LLM. */
    segment?: {
      segment_found: boolean
      skip_reason?: SegmentSkipReason
    }
    /** LLM-graded assertions. Only present fields are scored. */
    grading?: {
      elements?: Partial<Record<ElementKey, boolean>>
      violation?: boolean
      /** Passes if the model's overall_script_adherence is in this set. */
      overall_in?: OverallAdherence[]
      correctly_identified_as_fdr?: boolean
    }
  }
}

// ── Building blocks for the compliant welcome call ──────────────────────────

const PENNIE_HANDOFF = [
  "[handling agent]: Alright Maria, great news — everything is approved on our end. I'm going to connect you now to Freedom Debt Relief so they can complete your welcome call and get your program started. Please stay on the line.",
  "[contact]: Okay, thank you so much.",
]

const BLOCKS: Record<string, string[]> = {
  greeting: [
    "[transfer agent]: Hi Maria, thank you for holding. My name is Jordan, I'm a Client Success Advocate with Freedom Debt Relief, and I'll be completing your welcome call today to get you started with your program.",
    "[contact]: Hi Jordan, nice to meet you.",
  ],
  recording: [
    "[transfer agent]: Before we begin, please be aware that this call will be recorded for quality and training purposes.",
    "[contact]: That's fine.",
  ],
  credibility: [
    "[transfer agent]: You're in great hands. Freedom Debt Relief has been an industry leader for over 20 years, we've served more than one million clients, and we're recognized by trusted sources like the BBB, USA Today, and TrustPilot. We're a company that delivers on its promises.",
  ],
  agenda: [
    "[transfer agent]: Here's what we'll cover today. First, the keys to being successful in your program. Second, setting up your client account and dashboard. And third, walking through the helpful tools available to you.",
    "[contact]: Sounds good.",
  ],
  deposits: [
    "[transfer agent]: The first key is your Dedicated Account. Instead of paying your enrolled creditors directly, your deposit of two hundred sixty dollars will be drafted automatically into your Dedicated Account every month, and your first deposit will be on March 15th. It's very important that those deposits are made in full and on time.",
    "[contact]: Got it, March 15th every month.",
  ],
  negotiation: [
    "[transfer agent]: The second key is negotiations. Our patented technology creates a customized plan to negotiate with each creditor at the best time for maximum savings. Based on your plan, your estimated first settlements should come within the first four to six months.",
  ],
  authorizations: [
    "[transfer agent]: The third key is authorizations. We restructure your repayment terms as fast as possible, and when new terms are ready you'll be notified through the app, your web dashboard, email, or text. Settlement offers are time-sensitive, so authorizing quickly keeps your program on track and maximizes your savings.",
    "[contact]: Okay, I'll keep an eye out for those.",
  ],
  dashboard: [
    "[transfer agent]: Now let's set up your client dashboard. You should have received a setup email from us — go ahead and locate it, click the link to reset your password, and log in. I can also help you download the Freedom Debt Relief app while we're at it.",
    "[contact]: Okay, I found the email and I'm logged in now. I'll grab the app too.",
  ],
  tools: [
    "[transfer agent]: Perfect. You'll also receive your Program Guide email tomorrow, and remember the app is the first place to look for program information — your program status, your Dedicated Account balance, and your notifications are all right there, and you can always access the web dashboard as well.",
  ],
  closing: [
    "[transfer agent]: Before we wrap up, please add Freedom Debt Relief to your contacts. Our Customer Service number is 800-655-6303, and our Program Success Team is here for you 7 days a week. Congratulations again on taking this step, Maria — welcome to the program!",
    "[contact]: Thank you Jordan, this was really helpful. Bye!",
  ],
}

const FULL_ORDER = [
  "greeting",
  "recording",
  "credibility",
  "agenda",
  "deposits",
  "negotiation",
  "authorizations",
  "dashboard",
  "tools",
  "closing",
] as const

function welcomeCall(omit: readonly string[] = []): string {
  const lines = [...PENNIE_HANDOFF]
  for (const block of FULL_ORDER) {
    if (!omit.includes(block)) lines.push(...BLOCKS[block])
  }
  return lines.join("\n")
}

// ── Cases ────────────────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [
  {
    name: "full-adherence",
    description: "Every script element covered; should not flag a violation.",
    transcript: welcomeCall(),
    expect: {
      segment: { segment_found: true },
      grading: {
        elements: {
          greeting_and_identity_completed: true,
          recording_disclosure_provided: true,
          company_credibility_covered: true,
          call_agenda_provided: true,
          dedicated_account_deposits_explained: true,
          creditor_negotiation_explained: true,
          settlement_authorizations_explained: true,
          dashboard_account_setup_covered: true,
          tools_and_resources_covered: true,
          closing_and_support_provided: true,
        },
        violation: false,
        overall_in: ["full", "substantial"],
        correctly_identified_as_fdr: true,
      },
    },
  },
  {
    name: "missing-recording-disclosure",
    description:
      "Verbatim compliance beat absent — must be a violation even though everything else was covered.",
    transcript: welcomeCall(["recording"]),
    expect: {
      segment: { segment_found: true },
      grading: {
        elements: { recording_disclosure_provided: false },
        violation: true,
      },
    },
  },
  {
    name: "missing-deposits-and-authorizations",
    description:
      "Both highest-risk substantive elements missing — violation per rule (3).",
    transcript: welcomeCall(["deposits", "authorizations"]),
    expect: {
      segment: { segment_found: true },
      grading: {
        elements: {
          dedicated_account_deposits_explained: false,
          settlement_authorizations_explained: false,
          recording_disclosure_provided: true,
        },
        violation: true,
      },
    },
  },
  {
    name: "single-low-risk-gap",
    description:
      "Only tools_and_resources missing — substantial adherence, should NOT be a violation.",
    transcript: welcomeCall(["tools"]),
    expect: {
      segment: { segment_found: true },
      grading: {
        elements: { tools_and_resources_covered: false, recording_disclosure_provided: true },
        violation: false,
        overall_in: ["full", "substantial"],
      },
    },
  },
  {
    name: "minimal-coverage",
    description:
      "Rep greets and closes but skips the entire substance of the call — minimal/none, violation.",
    transcript: welcomeCall([
      "recording",
      "credibility",
      "agenda",
      "deposits",
      "negotiation",
      "authorizations",
      "dashboard",
      "tools",
    ]),
    expect: {
      segment: { segment_found: true },
      grading: {
        violation: true,
        overall_in: ["minimal", "none"],
      },
    },
  },
  {
    name: "wrong-company-identity",
    description:
      "Rep runs the welcome call but self-identifies with a different company — agent_identity_check must flag it.",
    transcript: [
      ...PENNIE_HANDOFF,
      "[transfer agent]: Hi Maria, thank you for holding. My name is Jordan and I'll be completing your welcome call today. I'm a Client Success Advocate here at ClearOne Advantage.",
      "[contact]: Hi Jordan.",
      ...BLOCKS.recording,
      ...BLOCKS.agenda,
      ...BLOCKS.deposits,
      ...BLOCKS.negotiation,
      ...BLOCKS.authorizations,
      ...BLOCKS.dashboard,
      ...BLOCKS.tools,
      ...BLOCKS.closing,
    ].join("\n"),
    expect: {
      segment: { segment_found: true },
      grading: {
        correctly_identified_as_fdr: false,
      },
    },
  },

  // ── Deterministic segmentation-only cases (no LLM call) ───────────────────
  {
    name: "skip-competitor-transfer",
    description:
      "Mis-transfer to Beyond Finance (a competitor) — must never be graded.",
    transcript: [
      "[handling agent]: Let me get you over to the next team to finish up your enrollment. One moment.",
      "[contact]: Okay.",
      "[transfer agent]: Thank you for calling Beyond Finance, this is Alex, how can I help you today?",
      "[contact]: Hi, I was just transferred to you for my welcome call?",
      "[transfer agent]: Hmm, let me take a look at what we have here.",
    ].join("\n"),
    expect: {
      segment: { segment_found: false, skip_reason: "competitor_transfer" },
    },
  },
  {
    name: "skip-no-transfer-leg",
    description: "Pennie-only call with no transfer — nothing to grade.",
    transcript: [
      "[handling agent]: Hi Maria, this is Taylor with Pennie on a recorded line, following up on your application.",
      "[contact]: Oh hi, yes I had a question about the documents you sent.",
      "[handling agent]: Of course, happy to walk through those. Once everything is signed we'll schedule your welcome call.",
      "[contact]: Great, thank you.",
    ].join("\n"),
    expect: {
      segment: { segment_found: false, skip_reason: "no_transfer_leg" },
    },
  },
  {
    name: "skip-welcome-call-blocked",
    description:
      "Live FDR rep joins but the agreement is unsigned, so the welcome call never starts — record, don't grade.",
    transcript: [
      "[handling agent]: Connecting you now to Freedom Debt Relief for your welcome call, one moment.",
      "[contact]: Okay.",
      "[transfer agent]: Hi, thank you for holding. My name is Sam with Freedom Debt Relief.",
      "[contact]: Hi Sam.",
      "[transfer agent]: I'm pulling up the file now. Unfortunately I'm showing we're still waiting for the agreement to be signed on your end, so I won't be able to proceed with the welcome call today.",
      "[contact]: Oh no, I thought that was done.",
      "[transfer agent]: I understand. Once the signature comes through, our team will reach back out to schedule it. I apologize for the inconvenience.",
    ].join("\n"),
    expect: {
      segment: { segment_found: false, skip_reason: "welcome_call_not_started" },
    },
  },
]
