# Range Words Compliance Reference

This document lists all words, phrases, and examples that Eavesly's QA system uses to evaluate whether an agent's claims are properly qualified or are unqualified guarantees.

---

## Accepted Range Words

These words are compliant when used to qualify outcomes. Agents will **not** be flagged for using them.

| Word |
|------|
| Typically |
| Commonly |
| Mostly |
| Naturally |
| Routinely |
| Ordinarily |
| Mainly |
| Most often |
| Per usual |
| Approximately |
| About |
| Around |
| On average |
| Estimated |
| Projected |
| Roughly |
| Usually |
| Normally |

---

## Accepted Qualifying Phrases

These phrases make a claim compliant when paired with it.

- "this can vary"
- "depends on your situation"
- "results vary"
- "not guaranteed"

---

## Accepted Compliant Phrasing

These phrases are not flagged unless paired with an unqualified guarantee.

- "signs of recovery"
- "get resolved"
- "first step"
- "become debt-free"

---

## Examples That PASS

1. "Your program term is estimated at around 48 months, but this can vary."
2. "On average, clients reduce overall debt, though results vary by creditor and situation."
3. "Your projected savings from the program is about $15,000 (this can vary)."
4. "Clients can see signs of recovery to their credit as accounts get resolved through the course of the program."
5. "Take your first step towards a debt-free future; many clients become debt-free in about 24–48 months (this can vary)."

---

## Examples That FAIL

1. "You **will be** out of debt in 48 months."
2. "I **guarantee** your debt will be settled at 50%."
3. "Your credit score **will** go up by 50 points in 2 months."
4. "Your credit score **is going to** go up in 3-6 months."
5. "Your accounts **will be** negotiated in 3 months."
6. "You **won't** receive any calls from the creditors."
7. "We **will** handle all the communication from your creditors."
8. "**I'm certain** all of your creditors will settle your debt."
9. "You **should** see all your debts settled in 48 months."
10. "It takes about 3-6 months to get your **settlements** in place." — Implies ALL settlements happen in that window; the compliant framing is that the FIRST settlement typically occurs in 3-6 months.

---

## Forbidden Phrases

These phrases are **factually incorrect or misrepresent Pennie's program**. They are ALWAYS flagged as a failure regardless of context or qualifiers.

| Phrase | Why It Fails |
|--------|-------------|
| "This program eliminates your interest" | Interest is not eliminated; it may continue to accrue during the program |
| "Zero percent interest" | Interest is not reduced to zero; it may continue to accrue during the program |
| "Paid as agreed" | Settled accounts are not reported as "paid as agreed"; they are reported as settled for less than full balance |
| "Doesn't blacklist you with creditors" | Creditors may still report negative information; the program does not prevent this |
| "This isn't debt relief" | The program is a form of debt relief; denying this misrepresents the service |
| "This isn't debt settlement" | The program involves debt settlement; denying this misrepresents the service |

---

## How the System Evaluates

- If an agent uses an accepted range word or qualifying phrase, the claim is evaluated as **compliant** (PASS).
- If an agent makes a statement with certainty — even without saying "guarantee" — it is flagged as a **misleading claim** (FAIL).
- The system evaluates the full claim in context. A range word elsewhere in the conversation does not excuse an unqualified guarantee in a separate statement.
