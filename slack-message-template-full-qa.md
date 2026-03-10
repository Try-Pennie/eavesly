## Slack Message Template — Full QA Escalation

Use these variables in the Slack Workflow "Send a message" step.
The webhook trigger payload uses the field names below as variable keys.

---

### Webhook Trigger Payload

```json
{
  "manager_review_reason": "string",
  "agent_email": "string",
  "manager_email": "string",
  "call_id": "string",
  "sfdc_lead_id": "string",
  "contact_name": "string",
  "call_duration": "string (e.g. 12m 34s)",
  "overall_tone": "string",
  "call_outcome": "string",
  "compliance_violations": "string (newline-separated list)",
  "areas_for_improvement": "string (newline-separated list)",
  "specific_coaching_points": "string (newline-separated list)",
  "transcript_url": "string (URL)",
  "recording_link": "string (URL)"
}
```

---

### Message Template

:rotating_light: *Manager Escalation Required*

Please review the below due to *{manager_review_reason}*:

*Call Details*
- *Agent:* {agent_email}
- *Manager:* {manager_email}
- *Regal Call ID:* {call_id}
- *Lead ID:* {sfdc_lead_id}
- *Lead Name:* {contact_name}
- *Call Duration:* {call_duration}

*Call Summary*
- *Call Tone:* {overall_tone}
- *Call Outcome:* {call_outcome}

*Compliance Issues*
{compliance_violations}

*Areas for Improvement*
{areas_for_improvement}

*Coaching Points*
{specific_coaching_points}
---
<{transcript_url}|:link: View Transcript & Recording on Regal>
<{recording_link}|:speaking_head_in_silhouette: Listen to Call Recording>
