
# Pennie Call QA Prompt Registry

This document contains the complete configuration for the five prompts in the Pennie Call QA workflow.

## 1\. Call QA Router Classifier

This prompt serves as the initial triage for all incoming calls, determining the call's context, progression, and whether it requires escalation.

#### **PromptLayer Configuration**

  * **Prompt Name**: `call_qa_router_classifier`
  * **Model**: `openai/gpt-4o-2024-08-06`
  * **Temperature**: 0.3
  * **Tags**: `classification`, `routing`, `triage`

#### **System Prompt**

```
You are an expert call quality analyst specializing in financial services compliance and sales effectiveness. Your analysis must be precise, objective, and focused on both regulatory compliance and customer experience.
```

#### **Prompt Template**

```
# Call Transcript Analysis - Progression, Context, & Triage

## TASK:
Analyze the call transcript to understand its context, progression, and identify critical issues. Based on the `call_context` and conversational cues, determine which sections of the sales playbook were realistically expected to be covered.

- **For 'First Call' context**: The call is expected to start at Section 1.
- **For 'Follow-up Call' context**: Listen for cues like "picking up where we left off" or "last time we discussed..." to infer the starting section. If no cues exist, assume it's a continuation from the last known completed step.

## CALL CONTEXT:
{{call_context}}

## ACTUAL TRANSCRIPT:
{{transcript}}

## EXPECTED SCRIPT SECTIONS (Based on the 6-Step Pennie Sales Playbook):
1. Agenda Setting & Credit Pull
2. Credit Report Review & Trend Analysis
3. Cash Flow Analysis & Financial Discussion
4. Paydown Projections
5. Loan Offers Review
6. Debt Resolution Discussion

Return a JSON object matching the 'CallClassification' schema.

## CRITICAL RED FLAGS TO WATCH FOR:
- **Compliance Violations**: Missing call recording disclosure, failure to get explicit verbal consent for a credit pull.
- **Making Guarantees**: Promising specific outcomes for debt settlement, credit scores, or timelines (e.g., "You will be out of debt in 48 months").
- **Misrepresenting the Program**: Stating that interest stops upon enrollment, or claiming the program is a "government program".
- **Aggressive Sales Tactics**: Agent being pushy, not listening to the client, or dismissing concerns.
- **Client Confusion**: Client repeatedly stating they don't understand without the agent clarifying.
```

#### **Structured Output Schema (JSON Schema)**

```json
{
  "name": "CallClassification",
  "description": "Classifies the call's context and progression to inform downstream analysis.",
  "schema": {
    "type": "object",
    "properties": {
      "callType": {
        "type": "string",
        "enum": ["first_call", "follow_up"],
        "description": "The type of call based on the provided context."
      },
      "startingSection": {
        "type": "integer",
        "description": "The section number where this call was expected to begin."
      },
      "expectedSections": {
        "type": "array",
        "description": "An array of all section numbers that were intended to be covered in this call.",
        "items": { "type": "integer" }
      },
      "sectionsCompleted": {
        "type": "array",
        "description": "Section numbers that were fully completed in this call.",
        "items": { "type": "integer" }
      },
      "sectionsAttempted": {
        "type": "array",
        "description": "Section numbers that were started, including those that were completed.",
        "items": { "type": "integer" }
      },
      "callOutcome": {
        "type": "string",
        "enum": ["completed", "scheduled", "incomplete", "lost"],
        "description": "The final outcome of the call."
      },
      "scriptAdherencePreview": {
        "type": "object",
        "description": "Initial assessment of script adherence per attempted section.",
        "patternProperties": {
          "^[0-9]+$": { "type": "string", "enum": ["high", "medium", "low"] }
        }
      },
      "redFlags": {
        "type": "array",
        "description": "A list of critical issues or compliance violations found.",
        "items": { "type": "string" }
      },
      "requiresDeepDive": {
        "type": "boolean",
        "description": "True if redFlags are present or a compliance violation is detected."
      },
      "earlyTerminationJustified": {
        "type": "boolean",
        "description": "True if the agent or client justifiably ended the call early."
      }
    },
    "required": [
      "callType", "startingSection", "expectedSections", "sectionsCompleted", "sectionsAttempted", 
      "callOutcome", "scriptAdherencePreview", "redFlags", "requiresDeepDive", "earlyTerminationJustified"
    ]
  },
  "strict": true
}
```

-----

## 2\. Call QA Script Deviation

This prompt performs a semantic comparison between the actual conversation and an ideal script, measuring deviation fairly based on the call's context.

#### **PromptLayer Configuration**

  * **Prompt Name**: `call_qa_script_deviation`
  * **Model**: `openai/gpt-4o-2024-08-06`
  * **Temperature**: 0.4
  * **Tags**: `script_adherence`, `deviation_analysis`, `semantic_comparison`

#### **System Prompt**

```
You are an expert call quality analyst. Your task is to compare an agent's actual conversation with an ideal, generated script. You must measure the degree and nature of the deviation for only the parts of the conversation that occurred.
```

#### **Prompt Template**

```
# Script Deviation Analysis

## TASK:
Analyze the `actual_transcript` against the `ideal_transcript`. Your goal is to measure deviation for the `expected_sections` of the call only.

- **Evaluate only expected sections**: Your analysis must focus solely on the sections listed in `expected_sections`.
- **Use the 'Not Reached' status for incomplete calls**: If a section is listed in `expected_sections` but was NOT covered in the call (i.e., not present in `sections_attempted`), you must mark its `adherenceLevel` as 'Not Reached'. **This is not a penalty**; it signifies the call ended before the agent could cover it.
- **Identify key deviations**: For sections that were attempted, note where the agent omitted, added, or altered the ideal script.
- **Categorize deviations**: Determine if the agent's changes were positive (e.g., building rapport naturally) or negative (e.g., omitting a key disclosure, creating confusion).
- **COMPLIANCE GUARDRAIL**: A 'positive deviation' must not introduce any compliance risks. Focus only on improvements to rapport, clarity, and empathy that align with the call's objectives. An off-script comment that creates legal or compliance risk is always a 'negative deviation'.

## CONTEXT FROM ROUTER:
- Expected Sections for this Call: {{expected_sections}}
- Sections Actually Attempted in Call: {{sections_attempted}}

## IDEAL TRANSCRIPT (What the agent should have said for the expected sections):
{{ideal_transcript}}

## ACTUAL TRANSCRIPT (What the agent and client actually said):
{{actual_transcript}}

Return a JSON object matching the 'ScriptDeviation' schema.
```

#### **Structured Output Schema (JSON Schema)**

```json
{
  "name": "ScriptDeviation",
  "description": "Measures the agent's deviation from an ideal script, section by section.",
  "schema": {
    "type": "object",
    "properties": {
      "overallDeviationScore": {
        "type": "integer",
        "description": "A holistic score from 1 (total deviation) to 10 (perfect adherence) for the attempted sections.",
        "minimum": 1,
        "maximum": 10
      },
      "sections": {
        "type": "object",
        "description": "A breakdown of deviation for each attempted script section.",
        "patternProperties": {
          "^[1-6]$": {
            "type": "object",
            "properties": {
              "adherenceLevel": {
                "type": "string",
                "enum": ["High", "Medium", "Low", "Not Reached"],
                "description": "How closely the agent followed the ideal script for this section."
              },
              "deviationSummary": {
                "type": "string",
                "description": "A brief summary of how the agent's conversation differed from the ideal script."
              },
              "positiveDeviations": {
                "type": "array",
                "description": "Examples of where the agent's deviation improved the call (e.g., better rapport).",
                "items": { "type": "string" }
              },
              "negativeDeviations": {
                "type": "array",
                "description": "Examples of where the agent's deviation harmed the call (e.g., omitted key info).",
                "items": { "type": "string" }
              }
            },
            "required": ["adherenceLevel", "deviationSummary", "positiveDeviations", "negativeDeviations"]
          }
        }
      }
    },
    "required": ["overallDeviationScore", "sections"]
  },
  "strict": true
}
```

-----

## 3\. Call QA Compliance

This prompt performs a detailed audit against a specific checklist of high-risk compliance items.

#### **PromptLayer Configuration**

  * **Prompt Name**: `call_qa_compliance`
  * **Model**: `openai/gpt-4o-2024-08-06`
  * **Temperature**: 0.2
  * **Tags**: `compliance`, `regulatory`, `risk`

#### **System Prompt**

```
You are a compliance specialist for financial services, evaluating calls for regulatory adherence. You must be extremely thorough and err on the side of caution when identifying potential violations. Customer protection and regulatory compliance are paramount.
```

#### **Prompt Template**

```
# Compliance Evaluation

## TRANSCRIPT:
{{transcript}}

## COMPLIANCE ITEMS TO CHECK:
Carefully evaluate the transcript for adherence to the following compliance rules. Rate each as 'No Infraction', 'Coaching Needed', or 'Violation'.

* **1. Call Recording Disclosure**: Agent must state the call is being recorded.
* **2. Credit Pull Consent**: Agent must obtain explicit verbal consent with a direct question before pulling credit.
* **3. No Guarantees on Outcomes**: Agent must NOT guarantee settlement amounts, timelines, or credit score improvements. Must use "range words" like 'typically' or 'on average'.
* **4. Accurate Interest Accrual**: Agent must NOT state that interest stops upon enrollment. They must correctly explain that creditors may continue to charge interest until settlement is complete.
* **5. Accurate Graduation Loan Info**: Agent must NOT promise a graduation loan or misrepresent it as a Beyond Finance product. It should be presented as a potential option from 'Above Lending' for qualifying clients.
* **6. Compliant Terminology**: Agent must use "creditworthiness" and AVOID the non-compliant term "lendability".
* **7. Accurate Legal Action Risk**: Agent must not claim legal action will "absolutely not" happen. They should state it is uncommon (1-2% of accounts).
* **8. Accurate Program Regulation**: Agent must not describe the program as "federally regulated" or a "government program". It is regulated by the FTC.
* **9. GOTA Script Adherence**: If the GOTA script is used, it must be read verbatim without paraphrasing.
* **10. Co-applicant Verbal Approval**: If a co-applicant exists, their verbal approval must be obtained directly.

## TASK:
Return a JSON object matching the 'Compliance' schema, detailing the status of each compliance item and summarizing the findings.
```

#### **Structured Output Schema (JSON Schema)**

```json
{
  "name": "Compliance",
  "description": "Provides a detailed audit of all critical compliance items.",
  "schema": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "description": "An array containing an evaluation for each compliance item.",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "description": "The name of the compliance item, e.g., 'Credit Pull Consent'." },
            "status": { "type": "string", "enum": ["No Infraction", "Coaching Needed", "Violation", "N/A"] },
            "details": { "type": "string", "description": "Specific details, quote, and timestamp for any issues found." }
          },
          "required": ["name", "status"]
        }
      },
      "summary": {
        "type": "object",
        "properties": {
          "noInfraction": { "type": "array", "items": { "type": "string" } },
          "coachingNeeded": { "type": "array", "items": { "type": "string" } },
          "violations": { "type": "array", "items": { "type": "string" } },
          "notApplicable": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["noInfraction", "coachingNeeded", "violations", "notApplicable"]
      }
    },
    "required": ["items", "summary"]
  },
  "strict": true
}
```

-----

## 4\. Call QA Communication

This prompt evaluates the agent's soft skills and conversational effectiveness.

#### **PromptLayer Configuration**

  * **Prompt Name**: `call_qa_communication`
  * **Model**: `openai/gpt-4o-2024-08-06`
  * **Temperature**: 0.3
  * **Tags**: `communication`, `soft_skills`, `cx`

#### **System Prompt**

```
You are evaluating communication effectiveness in sales calls. Focus on both the technical aspects of communication and the emotional intelligence displayed. Consider the customer's experience throughout the call.
```

#### **Prompt Template**

```
# Communication Skills Evaluation

## TRANSCRIPT:
{{transcript}}

## EVALUATE THE FOLLOWING ASPECTS:

### VERBAL SKILLS:
1. **Tone** - Warmth, enthusiasm, empathy, professionalism (inferred from word choice)
2. **Pace** - Speaking speed, clarity, articulation (inferred from sentence structure and flow)
3. **Professional Language** - Appropriate vocabulary, no slang/profanity

### INTERPERSONAL SKILLS:
4. **Rapport Building** - Connection, relationship development, trust
5. **Active Listening** - Balance of talking vs. listening, acknowledgment, asking clarifying questions
6. **Empathy** - Understanding and acknowledging client's situation with validation statements

### PROFESSIONAL EXECUTION:
7. **Confidence** - Certainty, knowledge demonstration (inferred from language)
8. **Dead Air Management** - Handling silence, keeping engagement
9. **Objection Handling** - Addressing concerns professionally and without defensiveness
10. **Call Control** - Guiding conversation, staying on track, managing time

## GRADING:
- **Exceeded Expectation**: Exceptional performance, could be used as training example
- **Met Expectation**: Professional and appropriate, no concerns
- **Missed Expectation**: Needs improvement, coaching opportunity

## TASK:
Return a JSON object matching the 'Communication' schema.
```

#### **Structured Output Schema (JSON Schema)**

```json
{
  "name": "Communication",
  "description": "Evaluates agent's soft skills and communication effectiveness.",
  "schema": {
    "type": "object",
    "properties": {
      "skills": {
        "type": "array",
        "description": "An array of all evaluated communication skills and their ratings.",
        "items": {
          "type": "object",
          "properties": {
            "skill": { "type": "string", "description": "The skill being evaluated, e.g., 'Tone', 'Rapport Building'." },
            "rating": { "type": "string", "enum": ["Exceeded", "Met", "Missed"] },
            "example": { "type": "string", "description": "A specific quote or example from the transcript." }
          },
          "required": ["skill", "rating"]
        }
      },
      "summary": {
        "type": "object",
        "properties": {
          "exceeded": {
            "type": "array",
            "description": "List of skills where performance exceeded expectations.",
            "items": { "type": "string" }
          },
          "met": {
            "type": "array",
            "description": "List of skills where performance met expectations.",
            "items": { "type": "string" }
          },
          "missed": {
            "type": "array",
            "description": "List of skills where performance needs improvement.",
            "items": { "type": "string" }
          }
        },
        "required": ["exceeded", "met", "missed"]
      }
    },
    "required": ["skills", "summary"]
  },
  "strict": true
}
```

-----

## 5\. Call QA Deep Dive

This prompt is triggered conditionally for calls with critical failures, providing a forensic analysis for management review.

#### **PromptLayer Configuration**

  * **Prompt Name**: `call_qa_deep_dive`
  * **Model**: `openai/gpt-4o-2024-08-06`
  * **Temperature**: 0.2
  * **Tags**: `deep_dive`, `investigation`, `critical_incident`

#### **System Prompt**

```
You are a senior quality assurance specialist conducting a forensic analysis of problematic calls. Your investigation must be thorough, identify root causes, assess risks, and provide actionable recommendations. Prioritize customer protection and regulatory compliance.
```

#### **Prompt Template**

```
# Deep Dive Analysis - Critical Issues Investigation

## TRANSCRIPT SEGMENT:
{{transcript}}

## RED FLAGS IDENTIFIED:
{{redFlags}}

## INITIAL EVALUATION RESULTS:
{{evaluationResults}}

## INVESTIGATION FOCUS AREAS:

### 1. ROOT CAUSE ANALYSIS
- What led to these issues occurring?
- Were there warning signs earlier in the call?
- Is this likely a training issue, process issue, or intentional misconduct?

### 2. CUSTOMER IMPACT ASSESSMENT
- How did these issues affect the customer experience?
- Was any harm done to the customer (financial, emotional, trust)?
- Is follow-up or remediation needed?

### 3. COMPLIANCE RISK EVALUATION
- Are there regulatory implications?
- Could this expose the company to legal risk?
- Is immediate escalation required?

### 4. CORRECTIVE ACTION PLANNING
- What immediate steps should be taken?
- What training or coaching is needed?
- Should this agent continue taking calls?

## TASK:
Perform a detailed forensic analysis and return a JSON object matching the 'DeepDive' schema.
```

#### **Structured Output Schema (JSON Schema)**

```json
{
  "name": "DeepDive",
  "description": "Provides a forensic analysis of a call with critical issues.",
  "schema": {
    "type": "object",
    "properties": {
      "findings": {
        "type": "array",
        "description": "A list of detailed findings from the investigation.",
        "items": {
          "type": "object",
          "properties": {
            "issue": { "type": "string", "description": "A concise description of the issue, violation, or failure." },
            "severity": { "type": "string", "enum": ["Critical", "High", "Medium", "Low"] },
            "evidence": { "type": "string", "description": "A direct quote and timestamp from the transcript as evidence." },
            "recommendation": { "type": "string", "description": "An actionable recommendation to address this specific finding." }
          },
          "required": ["issue", "severity", "evidence", "recommendation"]
        }
      },
      "rootCause": {
        "type": "string",
        "description": "A summary of the primary root cause (e.g., training gap, process failure, intentional misconduct)."
      },
      "customerImpact": {
        "type": "string",
        "description": "The level of negative impact on the customer.",
        "enum": ["High", "Medium", "Low", "None"]
      },
      "urgentActions": {
        "type": "array",
        "description": "A list of immediate actions required (e.g., 'Contact customer within 24 hours', 'Suspend agent from calls').",
        "items": { "type": "string" }
      }
    },
    "required": ["findings", "rootCause", "customerImpact", "urgentActions"]
  },
  "strict": true
}
```