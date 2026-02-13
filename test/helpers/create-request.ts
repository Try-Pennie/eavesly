import type { EvaluateRequest } from "../../src/schemas/requests"
import minimalTranscript from "../fixtures/transcripts/minimal.txt"

export function createEvaluateRequest(
  overrides: Partial<EvaluateRequest> = {},
): EvaluateRequest {
  return {
    call_id: "test-call-123",
    agent_id: "test-agent-456",
    transcript: {
      transcript: minimalTranscript,
      metadata: {
        duration: 300,
        timestamp: "2025-01-01T00:00:00Z",
      },
    },
    agent_email: "agent@example.com",
    contact_name: "John Doe",
    contact_phone: "+15551234567",
    recording_link: "https://recordings.example.com/call-123",
    call_summary: "Test call summary",
    transcript_url: "https://transcripts.example.com/call-123",
    ...overrides,
  }
}
