"""
Pydantic models package.

This package contains all Pydantic models for request validation,
response serialization, and evaluation schemas.
"""

# Request models
from .requests import (
    CallContext,
    TranscriptMetadata,
    TranscriptData,
    ScriptProgress,
    FinancialProfile,
    ClientData,
    EvaluateCallRequest,
)

# Evaluation schemas
from .schemas import (
    # Enums
    CallOutcome,
    PerformanceRating,
    ComplianceStatus,
    AdherenceLevel,
    Severity,
    
    # Classification
    CallClassification,
    
    # Script Adherence
    SectionEvaluation,
    ScriptAdherence,
    
    # Compliance
    ComplianceItem,
    ComplianceSummary,
    Compliance,
    
    # Communication
    CommunicationSkill,
    CommunicationSummary,
    Communication,
    
    # Deep Dive
    Finding,
    DeepDive,
    
    # Evaluation Results
    EvaluationSummary,
    EvaluationResult,
)

# Response models
from .responses import (
    EvaluateCallResponse,
)

__all__ = [
    # Request models
    "CallContext",
    "TranscriptMetadata",
    "TranscriptData",
    "ScriptProgress",
    "FinancialProfile",
    "ClientData",
    "EvaluateCallRequest",
    
    # Evaluation schema enums
    "CallOutcome",
    "PerformanceRating",
    "ComplianceStatus",
    "AdherenceLevel",
    "Severity",
    
    # Evaluation schemas
    "CallClassification",
    "SectionEvaluation",
    "ScriptAdherence",
    "ComplianceItem",
    "ComplianceSummary",
    "Compliance",
    "CommunicationSkill",
    "CommunicationSummary",
    "Communication",
    "Finding",
    "DeepDive",
    "EvaluationSummary",
    "EvaluationResult",
    
    # Response models
    "EvaluateCallResponse",
]