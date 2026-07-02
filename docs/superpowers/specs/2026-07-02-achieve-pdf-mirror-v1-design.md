# Achieve Welcome-Call QA — PDF-Faithful Criteria (v1)

**Date:** 2026-07-02
**Author:** Noah (via Claude)
**Repos:** `eavesly` (backend/criteria), `quality-voice-view` (frontend/QVV)
**Status:** Design approved-by-default (user pre-authorized implementation → PR); PR is the review gate.

## Purpose

The Achieve `achieve-welcome-call-qa` module currently grades welcome calls against **6 loosely-thematic elements** that only partially match the **agreed-upon script** the Achieve/FDR agents actually follow (`01_Assets/Achieve_FDR_Welcome_Call_Script Wholesale.pdf`). This artifact is shown to **Achieve's management team** to demonstrate what their agents are doing against *their own* script — so the graded criteria must mirror the PDF beat-for-beat, and the QVV portal must display them recognizably.

### Gaps in v0 (why this change)
- **Missing compliance/verbatim beats:** the recording disclosure ("recorded for quality and training purposes", marked *Must-be-Verbatim* in the PDF) and identity verification (direct-inbound path) are not screened at all.
- **Criteria not in the PDF:** v0 screens for "results vary by creditor", "typical program duration", and "don't negotiate independently with creditors" — none of which appear in *this* welcome-call script.
- **Structure doesn't match:** the PDF has distinct sections (Introduction incl. 3 "keys", Dashboard, Tools, Closing) that managers recognize; v0's 6 abstractions blur them.

## Scope

- **In:** rewrite graded elements to mirror PDF; add compliance items (recording disclosure + conditional ID verification); recalibrate violation logic; bump script version; update QVV labels/definitions/grouping; keep old (v0) results rendering correctly (go-forward only).
- **Out (offered as follow-up):** re-grading historical v0 calls; splitting greeting vs. identity-verification into two separate graded rows; adding new segmentation markers.

## Decisions (defaults taken while user away)
1. **Fidelity:** Full PDF mirror — one graded element per transcript-gradable PDF beat (~10). Agent-side CRM actions ("Mark Status as Complete in SUIP Salesforce", "Send Dashboard Activation Email") are **not** graded — not present in the call transcript.
2. **Compliance:** graded **and** violation-triggering (see rules). ID verification graded **conditionally** (expected on direct-inbound; folded into element 1, not a separate row in v1).
3. **Historical:** **go-forward only.** `script_version` bumps `fdr_wholesale_db_pilot_v0` → `fdr_wholesale_db_pilot_v1`. Old rows keep rendering under v0 labels via version branching in the frontend.

---

## The canonical contract (both repos MUST match exactly)

`script_version = "fdr_wholesale_db_pilot_v1"`

### 10 graded elements

| # | `flag` (backend boolean) | `missingKey` (backend `missing_elements` + FE) | FE label | Section |
|---|---|---|---|---|
| 1 | `greeting_and_identity_completed` | `greeting_and_identity` | Greeting & identity | Introduction |
| 2 | `recording_disclosure_provided` | `recording_disclosure` | Recording disclosure | Introduction |
| 3 | `company_credibility_covered` | `company_credibility` | Company credibility | Introduction |
| 4 | `call_agenda_provided` | `call_agenda` | Call agenda | Introduction |
| 5 | `dedicated_account_deposits_explained` | `dedicated_account_deposits` | Dedicated Account & deposits | Three keys to success |
| 6 | `creditor_negotiation_explained` | `creditor_negotiation` | Creditor negotiation | Three keys to success |
| 7 | `settlement_authorizations_explained` | `settlement_authorizations` | Settlement authorizations | Three keys to success |
| 8 | `dashboard_account_setup_covered` | `dashboard_account_setup` | Dashboard setup | Dashboard & tools |
| 9 | `tools_and_resources_covered` | `tools_and_resources` | Tools & resources | Dashboard & tools |
| 10 | `closing_and_support_provided` | `closing_and_support` | Closing & support | Closing |

### Element definitions (verbatim-anchored to the PDF — used in BOTH the prompt `<script_elements>` and the FE `definition` field)

1. **greeting_and_identity** — Agent introduced themselves as a **Client Success Advocate** and welcomed the client to get started with their Freedom Debt Relief program. On **direct-inbound** calls the agent also verified identity (first/last name + phone, plus one of: DOB, last 4 of SSN, or physical address). On **warm-transfer** calls identity verification may have occurred pre-handoff and is not required within this segment. *(Script §1 — Introduction / Greeting)*
2. **recording_disclosure** — **[Compliance — verbatim]** Agent stated the call is recorded: *"this call will be recorded for quality and training purposes."* *(Script §1 — marked Must-be-Verbatim)*
3. **company_credibility** — Agent conveyed FDR credibility/reassurance: 20+ years as an industry leader, 1M+ clients served, recognition from trusted sources (BBB, USA Today, TrustPilot), a company that delivers on its promises. *(Script §1)*
4. **call_agenda** — Agent previewed the 3-part agenda: (1) keys to being successful, (2) setting up the client account/dashboard, (3) walking through helpful tools. *(Script §1)*
5. **dedicated_account_deposits** — Agent explained the **Dedicated Account**: instead of paying enrolled creditors directly, the deposit is made automatically into the Dedicated Account; gave the first deposit date and frequency; stressed deposits **in full and on time**. *(Script §1 — first key)*
6. **creditor_negotiation** — Agent explained negotiations: FDR's **patented technology** creates a customized plan to negotiate with each creditor **at the best time** for maximum savings; referenced the client's estimated first settlements. *(Script §1 — second key)*
7. **settlement_authorizations** — Agent explained authorizations: FDR restructures repayment terms as fast as possible; when new terms are ready the client is **notified via app, web dashboard, email, or text**; settlement offers are **time-sensitive** and authorizing quickly keeps the program on track and maximizes savings. *(Script §1 — third key)*
8. **dashboard_account_setup** — Agent walked the client through (or offered to walk through) setting up the client **dashboard** on web + app: locating the setup email, resetting the password, logging in; and **offered help downloading the FDR app**. If the client declined, the agent should still have offered. *(Script §2 — Dashboard)*
9. **tools_and_resources** — Agent covered tools/resources: the **Program Guide** email arriving the next day, and that the **app** is the first place for program info (program status, Dedicated Account balance, notifications, web dashboard access). *(Script — Tools)*
10. **closing_and_support** — Agent closed with support info: encouraged **adding FDR to contacts**, gave the **Customer Service number (800-655-6303)**, referenced the **Program Success Team** and availability (*"here for you 7 days a week"*), warm congratulatory close. *(Script — Closing)*

### `overall_script_adherence` enum (expanded to match FE, which already renders 5)
`["full", "substantial", "partial", "minimal", "none"]` (was `["full","partial","minimal"]`).

Guidance for the model (by count of missing applicable elements): `full` = 0 missing · `substantial` = 1–2 · `partial` = 3–5 · `minimal` = 6–8 · `none` = 9–10.

### Violation rule (v1)
`violation = true` if **any** of:
- `recording_disclosure` is missing (**compliance**), **OR**
- `overall_script_adherence` is `"minimal"` or `"none"`, **OR**
- **both** `dedicated_account_deposits` **AND** `settlement_authorizations` are missing (the two highest-risk substantive omissions).

Unchanged shapes: `missing_elements: string[]` (base `missingKey`s), `key_evidence_quotes: string[]`, `violation: boolean`, `violation_reason: string`, `call_overview`, `assessment_confidence`, `transcript_segment`.

---

## Backend changes (`eavesly`)
- `prompts/achieve-welcome-call-qa.txt` — rewrite `<script_elements>` to the 10 elements above (verbatim-anchored). Update `determine_violation` step to the v1 rule. In `assess_each_element`, note element 1's ID-verify is conditional on direct-inbound (mark covered on transfer calls where the greeting is present and ID-verify not required). Flag element 2 as compliance/verbatim. Keep `<system>`, `collect_evidence`, `assess_call`, `assess_confidence`, `transcript_format_note`.
- `src/schemas/achieve-welcome-call-qa.ts` — replace the 6 booleans with the 10; expand `overall_script_adherence` enum to 5.
- `src/modules/achieve-welcome-call-qa/module.ts` — bump `SCRIPT_VERSION` to `fdr_wholesale_db_pilot_v1`. No other logic change (still reads `script_adherence.violation`).
- `src/modules/achieve-welcome-call-qa/segment.ts` — **no change** (existing markers still capture the segment).
- `src/services/prompt-sync.ts` — **no code change**; it mirrors the `.txt` into `eavesly_module_prompts` on deploy, so the Admin prompt viewer shows v1 automatically after deploy.
- Grep for any test/reference to the old 6 booleans and update. **Gate = `npm test`** (main has 5 known pre-existing failures + tsc `Serializable` errors — do not chase those; require no *new* failures).

## Frontend changes (`quality-voice-view`)
- `src/lib/achieve-checklist.ts`:
  - Rename current `ACHIEVE_ELEMENTS` → `ACHIEVE_ELEMENTS_V0` (keep its 6 entries + definitions unchanged, for old rows).
  - Add `ACHIEVE_ELEMENTS_V1` with the 10 elements (flag, missingKey, label, definition, **`section`**).
  - Add `section` to the `AchieveElement` type.
  - `deriveChecklist(adherence, scriptVersion?)` selects V1 when `scriptVersion` is `fdr_wholesale_db_pilot_v1`+ (or the adherence object has a v1-only flag like `recording_disclosure_provided`), else V0. Default export `ACHIEVE_ELEMENTS = ACHIEVE_ELEMENTS_V1`.
  - `humanizeElementKeys(text, scriptVersion?)` uses the matching set.
  - `ADHERENCE_LABELS` already covers all 5 — no change.
- `src/pages/AchievePortalPage.tsx` — pass `result_json.script_version` into `deriveChecklist`/`humanizeElementKeys`. **Group the checklist rows by `section`** (Introduction / Three keys to success / Dashboard & tools / Closing) so Achieve managers recognize the script structure. Queue-row gap count still derives from `missing_elements` — works unchanged.
- `src/lib/achieve-checklist.check.ts` — update the guard to cover the V1 set.
- Gate = the repo's check/build scripts (`npm run` — run the checklist check + `npm run build`).

## Post-merge ops (not in the PRs)
- Deploy `eavesly` so `prompt-sync` refreshes the `eavesly_module_prompts` mirror (Admin viewer then shows v1).
- Optional follow-up: re-grade historical Achieve calls under v1 for a uniform management report.

## Test / validation
- Backend: `npm test` green except the 5 known-baseline failures; schema compiles; a segment fixture still grades (existing `segment.test.ts` unaffected).
- Frontend: checklist check passes; `npm run build` clean; a v1 result renders 10 grouped rows; a v0 result still renders the 6 old rows correctly (version branch).
