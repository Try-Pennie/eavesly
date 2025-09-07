"""
Pydantic models for API request validation.

These models ensure proper validation of incoming requests.
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, List, Literal
from datetime import datetime
from enum import Enum
import logging


class CallContext(str, Enum):
    """Call context enumeration"""
    FIRST_CALL = "First Call"
    FOLLOW_UP_CALL = "Follow-up Call"


class TranscriptMetadata(BaseModel):
    """Metadata for call transcript"""
    duration: int = Field(..., gt=0, description="Call duration in seconds")
    timestamp: datetime = Field(..., description="Call timestamp")
    talk_time: Optional[int] = Field(None, gt=0)
    disposition: str = Field(..., min_length=1)
    campaign_name: Optional[str] = None


class TranscriptData(BaseModel):
    """Call transcript with metadata"""
    transcript: str = Field(..., min_length=1)
    metadata: TranscriptMetadata


class ScriptProgress(BaseModel):
    """Progress through the call script"""
    sections_attempted: List[int] = Field(..., min_items=1)
    last_completed_section: int = Field(..., ge=0)
    termination_reason: str = Field(..., min_length=1)
    pitch_outcome: Optional[str] = None
    
    @validator('termination_reason')
    def validate_termination_reason(cls, v):
        valid_reasons = {
            "loan_approved", "loan_denied", "not_interested",
            "callback_scheduled", "agent_error", "completed"
        }
        if v not in valid_reasons:
            # Allow custom reasons but log warning
            logging.warning(f"Non-standard termination reason: {v}")
        return v


class FinancialProfile(BaseModel):
    """Client financial information"""
    annual_income: Optional[float] = Field(None, gt=0)
    dti_ratio: Optional[float] = Field(None, ge=0, le=1)
    loan_approval_status: Optional[Literal["approved", "denied", "pending"]] = None
    has_existing_debt: Optional[bool] = None


class ClientData(BaseModel):
    """Aggregate client data for call evaluation"""
    lead_id: Optional[str] = None
    campaign_id: Optional[int] = None
    script_progress: ScriptProgress
    financial_profile: Optional[FinancialProfile] = None


class EvaluateCallRequest(BaseModel):
    """Main request model for call evaluation"""
    call_id: str = Field(..., min_length=1)
    agent_id: str = Field(..., min_length=1)
    call_context: CallContext
    transcript: TranscriptData
    ideal_script: str = Field(..., min_length=1)
    client_data: ClientData
    
    class Config:
        json_schema_extra = {
            "example": {
                "call_id": "call_123",
                "agent_id": "agent_456",
                "call_context": "First Call",
                "transcript": {
                    "transcript": "Agent: Hello, this is Sarah from Pennie. I understand you're interested in our loan services. Can I get your name?\\nClient: Yes, it's John Smith.\\nAgent: Great John, let me tell you about our current rates...",
                    "metadata": {
                        "duration": 300,
                        "timestamp": "2024-01-15T10:30:00Z",
                        "talk_time": 240,
                        "disposition": "completed",
                        "campaign_name": "Q1 Personal Loans"
                    }
                },
                "ideal_script": "Section 1: Introduction and greeting\\nSection 2: Needs assessment\\nSection 3: Product presentation\\nSection 4: Objection handling\\nSection 5: Closing",
                "client_data": {
                    "lead_id": "lead_789",
                    "campaign_id": 101,
                    "script_progress": {
                        "sections_attempted": [1, 2, 3, 4, 5],
                        "last_completed_section": 5,
                        "termination_reason": "loan_approved",
                        "pitch_outcome": "approved"
                    },
                    "financial_profile": {
                        "annual_income": 75000.0,
                        "dti_ratio": 0.35,
                        "loan_approval_status": "approved",
                        "has_existing_debt": True
                    }
                }
            }
        }