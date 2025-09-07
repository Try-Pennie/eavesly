"""
Pydantic schemas for evaluation results.

These models define the structure of LLM evaluation outputs.
"""

from pydantic import BaseModel, Field
from typing import Dict, List, Optional
from datetime import datetime
from enum import Enum


class CallOutcome(str, Enum):
    """Possible call outcomes"""
    COMPLETED = "completed"
    SCHEDULED = "scheduled"
    INCOMPLETE = "incomplete"
    LOST = "lost"


class PerformanceRating(str, Enum):
    """Performance rating levels"""
    EXCEEDED = "Exceeded"
    MET = "Met"
    MISSED = "Missed"
    NA = "N/A"


class ComplianceStatus(str, Enum):
    """Compliance status levels"""
    NO_INFRACTION = "No Infraction"
    COACHING_NEEDED = "Coaching Needed"
    VIOLATION = "Violation"
    NA = "N/A"


class AdherenceLevel(str, Enum):
    """Script adherence levels"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Severity(str, Enum):
    """Issue severity levels"""
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


# Classification Schema
class CallClassification(BaseModel):
    """Complete call classification results"""
    sections_completed: List[int] = Field(default_factory=list)
    sections_attempted: List[int] = Field(default_factory=list)
    call_outcome: CallOutcome
    script_adherence_preview: Dict[str, AdherenceLevel] = Field(default_factory=dict)
    red_flags: List[str] = Field(default_factory=list)
    requires_deep_dive: bool = False
    early_termination_justified: bool = False


# Script Adherence Schema
class SectionEvaluation(BaseModel):
    """Evaluation of a single script section"""
    content_accuracy: PerformanceRating
    sequence_adherence: PerformanceRating
    language_phrasing: PerformanceRating
    customization: PerformanceRating
    critical_misses: List[str] = Field(default_factory=list)
    quote: Optional[str] = None


class ScriptAdherence(BaseModel):
    """Overall script adherence evaluation"""
    sections: Dict[str, SectionEvaluation] = Field(default_factory=dict)


# Compliance Schema
class ComplianceItem(BaseModel):
    """Individual compliance item evaluation"""
    name: str
    status: ComplianceStatus
    details: Optional[str] = None


class ComplianceSummary(BaseModel):
    """Summary of compliance items by status"""
    no_infraction: List[str] = Field(default_factory=list)
    coaching_needed: List[str] = Field(default_factory=list)
    violations: List[str] = Field(default_factory=list)
    not_applicable: List[str] = Field(default_factory=list)


class Compliance(BaseModel):
    """Complete compliance evaluation"""
    items: List[ComplianceItem] = Field(default_factory=list)
    summary: ComplianceSummary


# Communication Schema
class CommunicationSkill(BaseModel):
    """Individual communication skill evaluation"""
    skill: str
    rating: PerformanceRating
    example: Optional[str] = None


class CommunicationSummary(BaseModel):
    """Summary of communication skills by rating"""
    exceeded: List[str] = Field(default_factory=list)
    met: List[str] = Field(default_factory=list)
    missed: List[str] = Field(default_factory=list)


class Communication(BaseModel):
    """Complete communication skills evaluation"""
    skills: List[CommunicationSkill] = Field(default_factory=list)
    summary: CommunicationSummary


# Deep Dive Schema
class Finding(BaseModel):
    """Individual finding from deep dive analysis"""
    issue: str
    severity: Severity
    evidence: str
    recommendation: str


class DeepDive(BaseModel):
    """Deep dive analysis for problematic calls"""
    findings: List[Finding] = Field(default_factory=list)
    root_cause: str
    customer_impact: Severity
    urgent_actions: List[str] = Field(default_factory=list)


# Response Models
class EvaluationSummary(BaseModel):
    """Summary of the evaluation results"""
    strengths: List[str] = Field(default_factory=list)
    areas_for_improvement: List[str] = Field(default_factory=list)
    critical_issues: List[str] = Field(default_factory=list)


class EvaluationResult(BaseModel):
    """Complete evaluation result structure"""
    classification: CallClassification
    script_deviation: ScriptAdherence
    compliance: Compliance
    communication: Communication
    deep_dive: Optional[DeepDive] = None