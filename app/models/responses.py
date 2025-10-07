"""
Pydantic models for API responses.

These models define the structure of API responses.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from .schemas import EvaluationResult, EvaluationSummary


class EvaluateCallResponse(BaseModel):
    """Response model for call evaluation"""
    call_id: str
    correlation_id: str
    timestamp: datetime
    processing_time_ms: int
    evaluation: EvaluationResult
    overall_score: int = Field(..., ge=1, le=100)
    summary: EvaluationSummary
    
    class Config:
        json_schema_extra = {
            "example": {
                "call_id": "call_123",
                "correlation_id": "corr_456",
                "timestamp": "2024-01-15T10:35:00Z",
                "processing_time_ms": 2500,
                "overall_score": 85,
                "summary": {
                    "strengths": [
                        "Excellent rapport building with client",
                        "Clear explanation of loan terms",
                        "Professional tone throughout"
                    ],
                    "areas_for_improvement": [
                        "Could have addressed objections more thoroughly",
                        "Missed opportunity to upsell additional services"
                    ],
                    "critical_issues": []
                },
                "evaluation": {
                    "classification": {
                        "sections_completed": [1, 2, 3, 4, 5],
                        "sections_attempted": [1, 2, 3, 4, 5],
                        "call_outcome": "completed",
                        "script_adherence_preview": {
                            "introduction": "high",
                            "needs_assessment": "medium",
                            "product_presentation": "high"
                        },
                        "red_flags": [],
                        "requires_deep_dive": False,
                        "early_termination_justified": False
                    }
                }
            }
        }


class SkippedCallResponse(BaseModel):
    """Response model for skipped call evaluation"""
    call_id: str
    correlation_id: str
    timestamp: datetime
    processing_time_ms: int
    status: str = "skipped"
    reason: str
    details: Dict[str, Any]

    class Config:
        json_schema_extra = {
            "example": {
                "call_id": "call_123",
                "correlation_id": "eval_456",
                "timestamp": "2024-01-15T10:35:00Z",
                "processing_time_ms": 5,
                "status": "skipped",
                "reason": "talk_time_too_short",
                "details": {
                    "talk_time": 45,
                    "minimum_required": 60,
                    "message": "Call was not evaluated because talk_time is below minimum threshold"
                }
            }
        }