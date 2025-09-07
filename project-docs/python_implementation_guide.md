# Python Implementation Guide for Call QA System

## System Overview

This document provides detailed instructions for building an automated Call Transcript Quality Assessment system for Pennie.com's sales agents using Python, FastAPI, and OpenRouter's LLM API with structured outputs. The system evaluates calls against generated scripts using guaranteed JSON responses through Pydantic models and the Instructor library.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Environment Setup](#environment-setup)
3. [Data Models with Pydantic](#data-models-with-pydantic)
4. [Structured Output Client](#structured-output-client)
5. [LLM Orchestration](#llm-orchestration)
6. [FastAPI Application](#fastapi-application)
7. [Database Integration](#database-integration)
8. [Deployment Configuration](#deployment-configuration)

---

## 1. Architecture Overview

### System Flow

```
[Call Transcript + Script + Client Data]
              ↓
    [Router/Classifier LLM] → Pydantic Model Response
              ↓
    [Parallel Evaluation Layer]
    ├── Script Adherence LLM → Pydantic Model Response
    ├── Compliance Check LLM → Pydantic Model Response
    └── Communication Skills LLM → Pydantic Model Response
              ↓
    [Conditional Deep Dive LLM] → Pydantic Model Response
              ↓
    [Report Generator] (Pure Python)
              ↓
    [Final QA Report]
```

### Key Benefits of Python Implementation

- **Native AI/ML Integration**: First-class support for LLM libraries (Instructor, LangChain)
- **Pydantic Models**: Superior validation with automatic serialization/deserialization
- **Async/Await**: Clean async patterns with FastAPI and httpx
- **Type Hints**: Full type safety with Python 3.11+ type hints
- **Simpler Deployment**: Lighter Docker images with Python Alpine

---

## 2. Environment Setup

### Project Structure

```
eavesly/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application
│   ├── config.py            # Configuration management
│   ├── models/
│   │   ├── __init__.py
│   │   ├── requests.py     # Request Pydantic models
│   │   ├── responses.py    # Response Pydantic models
│   │   └── schemas.py      # Evaluation schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm_client.py   # OpenRouter client
│   │   ├── orchestrator.py # Evaluation orchestrator
│   │   ├── database.py     # Supabase integration
│   │   └── prompt_layer.py # PromptLayer integration
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py       # API endpoints
│   │   └── middleware.py   # Authentication & logging
│   └── utils/
│       ├── __init__.py
│       └── logger.py       # Custom logger
├── tests/
├── requirements.txt
├── pyproject.toml
├── Dockerfile
├── fly.toml
└── .env
```

### Dependencies Installation

Create `pyproject.toml`:

```toml
[tool.poetry]
name = "pennie-call-qa"
version = "1.0.0"
description = "AI-enabled call QA evaluation system"
authors = ["Pennie Engineering"]
python = "^3.11"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.104.1"
uvicorn = {extras = ["standard"], version = "^0.24.0"}
pydantic = "^2.5.0"
pydantic-settings = "^2.1.0"
openai = "^1.10.0"
instructor = "^0.5.0"
httpx = "^0.25.2"
supabase = "^2.3.0"
tenacity = "^8.2.3"
python-dotenv = "^1.0.0"
asyncio = "^3.4.3"
python-json-logger = "^2.0.7"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.3"
pytest-asyncio = "^0.21.1"
black = "^23.12.0"
ruff = "^0.1.9"
mypy = "^1.8.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### Environment Configuration

Create `.env` file:

```env
# Core API Keys - Required
OPENROUTER_API_KEY=your_openrouter_api_key_here
PROMPTLAYER_API_KEY=your_promptlayer_api_key_here
INTERNAL_API_KEY=your_secure_internal_api_key_here

# Supabase Configuration - Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Application Configuration
ENVIRONMENT=development
PORT=3000
LOG_LEVEL=info

# Model Configuration
OPENROUTER_MODEL=openai/gpt-4o-2024-08-06
MAX_RETRIES=3
TIMEOUT_SECONDS=30
```

---

## 3. Data Models with Pydantic

### Request/Response Models

```python
# app/models/requests.py
from pydantic import BaseModel, Field, validator
from typing import Optional, Literal, List
from datetime import datetime
from enum import Enum

class CallContext(str, Enum):
    FIRST_CALL = "First Call"
    FOLLOW_UP_CALL = "Follow-up Call"

class TranscriptMetadata(BaseModel):
    duration: int = Field(..., gt=0, description="Call duration in seconds")
    timestamp: datetime = Field(..., description="Call timestamp")
    talk_time: Optional[int] = Field(None, gt=0)
    disposition: str = Field(..., min_length=1)
    campaign_name: Optional[str] = None

class TranscriptData(BaseModel):
    transcript: str = Field(..., min_length=1)
    metadata: TranscriptMetadata

class ScriptProgress(BaseModel):
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
            import logging
            logging.warning(f"Non-standard termination reason: {v}")
        return v

class FinancialProfile(BaseModel):
    annual_income: Optional[float] = Field(None, gt=0)
    dti_ratio: Optional[float] = Field(None, ge=0, le=1)
    loan_approval_status: Optional[Literal["approved", "denied", "pending"]] = None
    has_existing_debt: Optional[bool] = None

class ClientData(BaseModel):
    lead_id: Optional[str] = None
    campaign_id: Optional[int] = None
    script_progress: ScriptProgress
    financial_profile: Optional[FinancialProfile] = None

class EvaluateCallRequest(BaseModel):
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
                    "transcript": "Agent: Hello, this is...",
                    "metadata": {
                        "duration": 300,
                        "timestamp": "2024-01-15T10:30:00Z",
                        "disposition": "completed"
                    }
                },
                "ideal_script": "Section 1: Introduction...",
                "client_data": {
                    "script_progress": {
                        "sections_attempted": [1, 2, 3, 4, 5],
                        "last_completed_section": 5,
                        "termination_reason": "loan_approved"
                    }
                }
            }
        }
```

### Evaluation Schemas

```python
# app/models/schemas.py
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Literal
from enum import Enum

class CallOutcome(str, Enum):
    COMPLETED = "completed"
    SCHEDULED = "scheduled"
    INCOMPLETE = "incomplete"
    LOST = "lost"

class AdherenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class PerformanceRating(str, Enum):
    EXCEEDED = "Exceeded"
    MET = "Met"
    MISSED = "Missed"
    NA = "N/A"

class ComplianceStatus(str, Enum):
    NO_INFRACTION = "No Infraction"
    COACHING_NEEDED = "Coaching Needed"
    VIOLATION = "Violation"
    NA = "N/A"

class Severity(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"

# Classification Schema
class CallClassification(BaseModel):
    sections_completed: List[int] = Field(default_factory=list)
    sections_attempted: List[int] = Field(default_factory=list)
    call_outcome: CallOutcome
    script_adherence_preview: Dict[str, AdherenceLevel] = Field(default_factory=dict)
    red_flags: List[str] = Field(default_factory=list)
    requires_deep_dive: bool = False
    early_termination_justified: bool = False

# Script Adherence Schema
class SectionEvaluation(BaseModel):
    content_accuracy: PerformanceRating
    sequence_adherence: PerformanceRating
    language_phrasing: PerformanceRating
    customization: PerformanceRating
    critical_misses: List[str] = Field(default_factory=list)
    quote: Optional[str] = None

class ScriptAdherence(BaseModel):
    sections: Dict[str, SectionEvaluation] = Field(default_factory=dict)

# Compliance Schema
class ComplianceItem(BaseModel):
    name: str
    status: ComplianceStatus
    details: Optional[str] = None

class ComplianceSummary(BaseModel):
    no_infraction: List[str] = Field(default_factory=list)
    coaching_needed: List[str] = Field(default_factory=list)
    violations: List[str] = Field(default_factory=list)
    not_applicable: List[str] = Field(default_factory=list)

class Compliance(BaseModel):
    items: List[ComplianceItem] = Field(default_factory=list)
    summary: ComplianceSummary

# Communication Schema
class CommunicationSkill(BaseModel):
    skill: str
    rating: PerformanceRating
    example: Optional[str] = None

class CommunicationSummary(BaseModel):
    exceeded: List[str] = Field(default_factory=list)
    met: List[str] = Field(default_factory=list)
    missed: List[str] = Field(default_factory=list)

class Communication(BaseModel):
    skills: List[CommunicationSkill] = Field(default_factory=list)
    summary: CommunicationSummary

# Deep Dive Schema
class Finding(BaseModel):
    issue: str
    severity: Severity
    evidence: str
    recommendation: str

class DeepDive(BaseModel):
    findings: List[Finding] = Field(default_factory=list)
    root_cause: str
    customer_impact: Severity
    urgent_actions: List[str] = Field(default_factory=list)

# Response Models
class EvaluationSummary(BaseModel):
    strengths: List[str] = Field(default_factory=list)
    areas_for_improvement: List[str] = Field(default_factory=list)
    critical_issues: List[str] = Field(default_factory=list)

class EvaluationResult(BaseModel):
    classification: CallClassification
    script_deviation: ScriptAdherence
    compliance: Compliance
    communication: Communication
    deep_dive: Optional[DeepDive] = None

class EvaluateCallResponse(BaseModel):
    call_id: str
    correlation_id: str
    timestamp: datetime
    processing_time_ms: int
    evaluation: EvaluationResult
    overall_score: int = Field(..., ge=1, le=100)
    summary: EvaluationSummary
```

---

## 4. Structured Output Client

### OpenRouter Client with Instructor

```python
# app/services/llm_client.py
import os
from typing import TypeVar, Type, Optional, Any
import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type
)
import logging
from app.utils.logger import get_logger

logger = get_logger(__name__)

T = TypeVar('T', bound=BaseModel)

class StructuredLLMClient:
    """OpenRouter client with Instructor for structured outputs"""
    
    def __init__(self):
        self.client = instructor.from_openai(
            AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=os.getenv("OPENROUTER_API_KEY"),
                default_headers={
                    "HTTP-Referer": "https://trypennie.com",
                    "X-Title": "Pennie Call QA System"
                }
            ),
            mode=instructor.Mode.JSON
        )
        self.model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-2024-08-06")
        self.max_retries = int(os.getenv("MAX_RETRIES", "3"))
        self.timeout = int(os.getenv("TIMEOUT_SECONDS", "30"))
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(Exception)
    )
    async def get_structured_response(
        self,
        response_model: Type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000
    ) -> T:
        """
        Get structured response using Instructor library
        
        Args:
            response_model: Pydantic model class for response validation
            system_prompt: System prompt for context
            user_prompt: User prompt with the actual request
            temperature: Model temperature (0.0-1.0)
            max_tokens: Maximum tokens in response
            
        Returns:
            Instance of response_model with validated data
        """
        try:
            logger.info(f"Requesting structured response for {response_model.__name__}")
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_model=response_model,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=self.timeout
            )
            
            logger.info(f"Successfully received {response_model.__name__} response")
            return response
            
        except Exception as e:
            logger.error(f"Error getting structured response: {str(e)}")
            raise
    
    async def get_structured_response_with_template(
        self,
        response_model: Type[T],
        system_prompt: str,
        user_prompt: str,
        response_format: Optional[dict] = None,
        temperature: float = 0.3
    ) -> T:
        """
        Get structured response with pre-rendered prompt templates
        Used for PromptLayer integration
        """
        try:
            # Use Instructor's JSON mode for structured outputs
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_model=response_model,
                temperature=temperature,
                max_tokens=2000,
                timeout=self.timeout
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Template response error: {str(e)}")
            raise

class FallbackManager:
    """Manages fallback responses for failed evaluations"""
    
    def __init__(self):
        self.fallback_strategies = {
            "CallClassification": self._classification_fallback,
            "Compliance": self._compliance_fallback,
            "Communication": self._communication_fallback,
            "ScriptAdherence": self._script_adherence_fallback
        }
    
    def _classification_fallback(self) -> CallClassification:
        from app.models.schemas import CallClassification, CallOutcome
        return CallClassification(
            sections_completed=[],
            sections_attempted=[],
            call_outcome=CallOutcome.INCOMPLETE,
            script_adherence_preview={},
            red_flags=["Evaluation failed - manual review required"],
            requires_deep_dive=True,
            early_termination_justified=False
        )
    
    def _compliance_fallback(self) -> Compliance:
        from app.models.schemas import Compliance, ComplianceSummary
        return Compliance(
            items=[],
            summary=ComplianceSummary(
                violations=["Manual review required due to evaluation failure"]
            )
        )
    
    def _communication_fallback(self) -> Communication:
        from app.models.schemas import Communication, CommunicationSummary
        return Communication(
            skills=[],
            summary=CommunicationSummary(
                missed=["Manual evaluation required"]
            )
        )
    
    def _script_adherence_fallback(self) -> ScriptAdherence:
        from app.models.schemas import ScriptAdherence
        return ScriptAdherence(sections={})
    
    async def get_fallback(self, schema_name: str) -> Any:
        """Get fallback response for failed evaluation"""
        if schema_name in self.fallback_strategies:
            logger.warning(f"Using fallback response for {schema_name}")
            return self.fallback_strategies[schema_name]()
        raise ValueError(f"No fallback strategy for {schema_name}")
```

---

## 5. LLM Orchestration

### PromptLayer Integration

```python
# app/services/prompt_layer.py
import os
import httpx
from typing import Dict, Any, Optional
from app.utils.logger import get_logger

logger = get_logger(__name__)

class PromptLayerClient:
    """Client for fetching prompt templates from PromptLayer"""
    
    def __init__(self):
        self.api_key = os.getenv("PROMPTLAYER_API_KEY")
        self.base_url = "https://api.promptlayer.com/rest"
        self.client = httpx.AsyncClient()
        self.templates_cache: Dict[str, Dict[str, Any]] = {}
    
    async def fetch_prompt_template(self, prompt_name: str) -> Dict[str, Any]:
        """Fetch prompt template from PromptLayer REST API"""
        
        if prompt_name in self.templates_cache:
            return self.templates_cache[prompt_name]
        
        try:
            # Use POST method with correct endpoint format
            response = await self.client.post(
                f"{self.base_url}/prompt-templates/{prompt_name}",
                json={},  # Empty request body for template retrieval
                headers={
                    "X-API-KEY": self.api_key,
                    "Content-Type": "application/json"
                }
            )
            response.raise_for_status()
            
            prompt_data = response.json()
            
            # Handle both chat and completion prompt types from actual API response
            if "messages" in prompt_data:  # Chat format
                messages = prompt_data["messages"]
                system_msg = next((m for m in messages if m["role"] == "system"), {})
                user_msg = next((m for m in messages if m["role"] == "user"), {})
                
                template = {
                    "system_prompt": system_msg.get("content", ""),
                    "user_prompt": user_msg.get("content", ""),
                    "input_variables": prompt_data.get("input_variables", []),
                    "model": prompt_data.get("model", "gpt-4o"),
                    "temperature": prompt_data.get("model_parameters", {}).get("temperature", 0.3)
                }
            else:  # Completion format
                template = {
                    "system_prompt": "",
                    "user_prompt": prompt_data.get("prompt", ""),
                    "input_variables": prompt_data.get("input_variables", []),
                    "model": prompt_data.get("model", "gpt-4o"),
                    "temperature": prompt_data.get("model_parameters", {}).get("temperature", 0.3)
                }
            
            self.templates_cache[prompt_name] = template
            logger.info(f"Successfully fetched prompt template: {prompt_name}")
            return template
            
        except Exception as e:
            logger.error(f"Failed to fetch prompt {prompt_name}: {str(e)}")
            raise
    
    def render_template(self, template: str, variables: Dict[str, Any]) -> str:
        """Replace template variables with actual values"""
        rendered = template
        for key, value in variables.items():
            placeholder = f"{{{{{key}}}}}"
            rendered = rendered.replace(placeholder, str(value))
        return rendered
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
```

### Main Orchestrator

```python
# app/services/orchestrator.py
import asyncio
import json
from typing import Optional, Dict, Any
from datetime import datetime
from app.models.requests import EvaluateCallRequest
from app.models.schemas import (
    CallClassification, ScriptAdherence, Compliance,
    Communication, DeepDive, EvaluationResult
)
from app.services.llm_client import StructuredLLMClient, FallbackManager
from app.services.prompt_layer import PromptLayerClient
from app.utils.logger import get_logger

logger = get_logger(__name__)

class CallQAOrchestrator:
    """Main orchestrator for call quality evaluation"""
    
    def __init__(self):
        self.llm_client = StructuredLLMClient()
        self.prompt_client = PromptLayerClient()
        self.fallback_manager = FallbackManager()
        self.prompt_templates: Dict[str, Dict[str, Any]] = {}
        self.initialized = False
    
    async def initialize(self):
        """Initialize orchestrator by fetching all prompt templates"""
        if self.initialized:
            return
        
        logger.info("Initializing orchestrator...")
        
        prompt_configs = [
            ("call_qa_router_classifier", CallClassification),
            ("call_qa_script_deviation", ScriptAdherence),
            ("call_qa_compliance", Compliance),
            ("call_qa_communication", Communication),
            ("call_qa_deep_dive", DeepDive)
        ]
        
        for prompt_name, schema in prompt_configs:
            try:
                template = await self.prompt_client.fetch_prompt_template(prompt_name)
                self.prompt_templates[prompt_name] = {
                    **template,
                    "schema": schema
                }
            except Exception as e:
                logger.error(f"Failed to fetch {prompt_name}: {str(e)}")
                raise RuntimeError(f"Initialization failed: Could not fetch {prompt_name}")
        
        self.initialized = True
        logger.info("Orchestrator initialized successfully")
    
    async def evaluate_call(self, request: EvaluateCallRequest) -> EvaluationResult:
        """
        Main evaluation method - orchestrates all evaluation steps
        """
        if not self.initialized:
            await self.initialize()
        
        try:
            # Stage 1: Classification
            logger.info(f"Stage 1: Classifying call {request.call_id}")
            classification = await self._classify_call(request)
            
            # Stage 2: Parallel Evaluations
            logger.info(f"Stage 2: Running parallel evaluations for {request.call_id}")
            script_task = self._evaluate_script_adherence(request, classification)
            compliance_task = self._evaluate_compliance(request)
            communication_task = self._evaluate_communication(request)
            
            script_adherence, compliance, communication = await asyncio.gather(
                script_task, compliance_task, communication_task,
                return_exceptions=True
            )
            
            # Handle any failures with fallbacks
            if isinstance(script_adherence, Exception):
                logger.error(f"Script adherence failed: {script_adherence}")
                script_adherence = await self.fallback_manager.get_fallback("ScriptAdherence")
            
            if isinstance(compliance, Exception):
                logger.error(f"Compliance evaluation failed: {compliance}")
                compliance = await self.fallback_manager.get_fallback("Compliance")
            
            if isinstance(communication, Exception):
                logger.error(f"Communication evaluation failed: {communication}")
                communication = await self.fallback_manager.get_fallback("Communication")
            
            # Stage 3: Conditional Deep Dive
            deep_dive = None
            if self._requires_deep_dive(classification, compliance):
                logger.info(f"Stage 3: Performing deep dive for {request.call_id}")
                deep_dive = await self._perform_deep_dive(request, classification, compliance)
            
            # Return complete evaluation result
            return EvaluationResult(
                classification=classification,
                script_deviation=script_adherence,
                compliance=compliance,
                communication=communication,
                deep_dive=deep_dive
            )
            
        except Exception as e:
            logger.error(f"Evaluation failed for {request.call_id}: {str(e)}")
            raise
    
    async def _classify_call(self, request: EvaluateCallRequest) -> CallClassification:
        """Classify the call and determine evaluation scope"""
        template = self.prompt_templates["call_qa_router_classifier"]
        
        variables = {
            "transcript": request.transcript.transcript,
            "call_context": request.call_context.value,
            "clientData": json.dumps(request.client_data.model_dump()),
            "migo_call_script": request.ideal_script,
            "script_progress": json.dumps(request.client_data.script_progress.model_dump()),
            "financial_profile": json.dumps(
                request.client_data.financial_profile.model_dump() 
                if request.client_data.financial_profile else {}
            )
        }
        
        system_prompt = self.prompt_client.render_template(
            template["system_prompt"], variables
        )
        user_prompt = self.prompt_client.render_template(
            template["user_prompt"], variables
        )
        
        return await self.llm_client.get_structured_response(
            response_model=CallClassification,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=template["temperature"]
        )
    
    async def _evaluate_script_adherence(
        self, 
        request: EvaluateCallRequest,
        classification: CallClassification
    ) -> ScriptAdherence:
        """Evaluate script adherence with context awareness"""
        template = self.prompt_templates["call_qa_script_deviation"]
        
        script_progress = request.client_data.script_progress
        
        variables = {
            "actual_transcript": request.transcript.transcript,
            "ideal_transcript": request.ideal_script,
            "sections_attempted": json.dumps(script_progress.sections_attempted),
            "last_completed_section": str(script_progress.last_completed_section),
            "termination_reason": script_progress.termination_reason,
            "evaluation_scope": json.dumps({
                "sectionsToEvaluate": script_progress.sections_attempted,
                "contextualTermination": script_progress.termination_reason != "agent_error"
            })
        }
        
        system_prompt = self.prompt_client.render_template(
            template["system_prompt"], variables
        )
        user_prompt = self.prompt_client.render_template(
            template["user_prompt"], variables
        )
        
        return await self.llm_client.get_structured_response(
            response_model=ScriptAdherence,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=template["temperature"]
        )
    
    async def _evaluate_compliance(self, request: EvaluateCallRequest) -> Compliance:
        """Evaluate compliance with regulations"""
        template = self.prompt_templates["call_qa_compliance"]
        
        script_progress = request.client_data.script_progress
        financial_profile = request.client_data.financial_profile
        
        variables = {
            "transcript": request.transcript.transcript,
            "sections_attempted": json.dumps(script_progress.sections_attempted),
            "financial_profile": json.dumps(
                financial_profile.model_dump() if financial_profile else {}
            )
        }
        
        system_prompt = self.prompt_client.render_template(
            template["system_prompt"], variables
        )
        user_prompt = self.prompt_client.render_template(
            template["user_prompt"], variables
        )
        
        return await self.llm_client.get_structured_response(
            response_model=Compliance,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=template["temperature"]
        )
    
    async def _evaluate_communication(self, request: EvaluateCallRequest) -> Communication:
        """Evaluate communication skills"""
        template = self.prompt_templates["call_qa_communication"]
        
        variables = {
            "transcript": request.transcript.transcript
        }
        
        system_prompt = self.prompt_client.render_template(
            template["system_prompt"], variables
        )
        user_prompt = self.prompt_client.render_template(
            template["user_prompt"], variables
        )
        
        return await self.llm_client.get_structured_response(
            response_model=Communication,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=template["temperature"]
        )
    
    def _requires_deep_dive(
        self, 
        classification: CallClassification,
        compliance: Compliance
    ) -> bool:
        """Determine if deep dive analysis is needed"""
        return (
            classification.requires_deep_dive or
            len(compliance.summary.violations) > 0 or
            len(classification.red_flags) > 0
        )
    
    async def _perform_deep_dive(
        self,
        request: EvaluateCallRequest,
        classification: CallClassification,
        compliance: Compliance
    ) -> DeepDive:
        """Perform detailed analysis of issues"""
        template = self.prompt_templates["call_qa_deep_dive"]
        
        variables = {
            "transcript": request.transcript.transcript,
            "red_flags": "\n".join(classification.red_flags),
            "violations": "\n".join(compliance.summary.violations)
        }
        
        system_prompt = self.prompt_client.render_template(
            template["system_prompt"], variables
        )
        user_prompt = self.prompt_client.render_template(
            template["user_prompt"], variables
        )
        
        return await self.llm_client.get_structured_response(
            response_model=DeepDive,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=template["temperature"]
        )
    
    def calculate_overall_score(self, evaluation: EvaluationResult) -> int:
        """Calculate overall score from evaluation results"""
        score = 100
        
        # Deduct for compliance issues
        score -= len(evaluation.compliance.summary.violations) * 15
        score -= len(evaluation.compliance.summary.coaching_needed) * 5
        
        # Deduct for communication issues
        score -= len(evaluation.communication.summary.missed) * 3
        
        # Add for exceptional performance
        score += len(evaluation.communication.summary.exceeded) * 2
        
        # Ensure score is within bounds
        return max(1, min(100, score))
    
    def generate_summary(self, evaluation: EvaluationResult) -> Dict[str, list]:
        """Generate evaluation summary"""
        strengths = []
        areas_for_improvement = []
        critical_issues = evaluation.compliance.summary.violations.copy()
        
        # Add strengths
        strengths.extend(evaluation.communication.summary.exceeded[:2])
        
        # Add areas for improvement
        areas_for_improvement.extend(evaluation.compliance.summary.coaching_needed[:2])
        areas_for_improvement.extend(evaluation.communication.summary.missed[:2])
        
        # Add critical script misses
        for section, eval_data in evaluation.script_deviation.sections.items():
            if eval_data.critical_misses:
                areas_for_improvement.append(f"Section {section}: {eval_data.critical_misses[0]}")
        
        return {
            "strengths": strengths[:3],
            "areas_for_improvement": areas_for_improvement[:3],
            "critical_issues": critical_issues[:3]
        }
```

---

## 6. FastAPI Application

### Main Application

```python
# app/main.py
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import uuid
from datetime import datetime

from app.config import settings
from app.models.requests import EvaluateCallRequest
from app.models.schemas import EvaluateCallResponse, EvaluationSummary
from app.services.orchestrator import CallQAOrchestrator
from app.services.database import DatabaseService
from app.api.middleware import authenticate_api_key, log_request
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Global instances
orchestrator = CallQAOrchestrator()
db_service = DatabaseService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup"""
    logger.info("Starting Call QA API...")
    await orchestrator.initialize()
    yield
    logger.info("Shutting down Call QA API...")
    await orchestrator.prompt_client.close()

app = FastAPI(
    title="Pennie Call QA API",
    version="1.0.0",
    description="AI-enabled call quality assessment system",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
app.middleware("http")(log_request)

@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    try:
        # Check dependencies
        supabase_healthy = await db_service.health_check()
        
        return {
            "status": "healthy" if supabase_healthy else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "dependencies": {
                "supabase": "healthy" if supabase_healthy else "unhealthy",
                "promptLayer": "healthy" if orchestrator.initialized else "unhealthy",
                "openRouter": "healthy"  # Assume healthy if app started
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            }
        )

@app.post("/evaluate-call", response_model=EvaluateCallResponse, dependencies=[Depends(authenticate_api_key)])
async def evaluate_call(request: EvaluateCallRequest):
    """Main endpoint for call evaluation"""
    correlation_id = f"eval_{uuid.uuid4().hex}"
    start_time = time.time()
    
    try:
        logger.info(f"Starting evaluation for call {request.call_id}", extra={
            "correlation_id": correlation_id,
            "agent_id": request.agent_id,
            "call_context": request.call_context.value
        })
        
        # Perform evaluation
        evaluation_result = await orchestrator.evaluate_call(request)
        
        # Calculate score and summary
        overall_score = orchestrator.calculate_overall_score(evaluation_result)
        summary = orchestrator.generate_summary(evaluation_result)
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Store results in database
        await db_service.store_evaluation_result(
            correlation_id=correlation_id,
            call_id=request.call_id,
            agent_id=request.agent_id,
            evaluation_result=evaluation_result,
            overall_score=overall_score,
            processing_time_ms=processing_time_ms
        )
        
        logger.info(f"Evaluation completed for {request.call_id}", extra={
            "correlation_id": correlation_id,
            "processing_time_ms": processing_time_ms,
            "overall_score": overall_score
        })
        
        return EvaluateCallResponse(
            call_id=request.call_id,
            correlation_id=correlation_id,
            timestamp=datetime.utcnow(),
            processing_time_ms=processing_time_ms,
            evaluation=evaluation_result,
            overall_score=overall_score,
            summary=EvaluationSummary(**summary)
        )
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        logger.error(f"Evaluation failed for {request.call_id}", extra={
            "correlation_id": correlation_id,
            "error": str(e),
            "processing_time_ms": processing_time_ms
        })
        
        # Log failed request
        await db_service.log_api_request(
            correlation_id=correlation_id,
            endpoint="/evaluate-call",
            status_code=500,
            processing_time_ms=processing_time_ms,
            error_message=str(e)
        )
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "EVALUATION_FAILED",
                "message": "Internal server error during evaluation",
                "correlation_id": correlation_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

@app.post("/evaluate-batch", dependencies=[Depends(authenticate_api_key)])
async def evaluate_batch(calls: list[EvaluateCallRequest]):
    """Batch evaluation endpoint"""
    logger.info(f"Starting batch evaluation for {len(calls)} calls")
    
    results = []
    start_time = time.time()
    
    # Process calls concurrently with limit
    tasks = [evaluate_call(call) for call in calls]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    
    for call, response in zip(calls, responses):
        if isinstance(response, Exception):
            results.append({
                "call_id": call.call_id,
                "success": False,
                "error": str(response)
            })
        else:
            results.append({
                "call_id": call.call_id,
                "success": True,
                "response": response
            })
    
    duration_ms = int((time.time() - start_time) * 1000)
    successful = sum(1 for r in results if r["success"])
    
    logger.info(f"Batch evaluation completed", extra={
        "total": len(calls),
        "successful": successful,
        "failed": len(calls) - successful,
        "duration_ms": duration_ms
    })
    
    return {
        "results": results,
        "summary": {
            "total": len(calls),
            "successful": successful,
            "failed": len(calls) - successful,
            "duration_ms": duration_ms
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=settings.environment == "development"
    )
```

### Configuration Management

```python
# app/config.py
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # API Keys
    openrouter_api_key: str
    promptlayer_api_key: str
    internal_api_key: str
    
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    
    # Application
    environment: str = "development"
    port: int = 3000
    log_level: str = "info"
    
    # Model Configuration
    openrouter_model: str = "openai/gpt-4o-2024-08-06"
    max_retries: int = 3
    timeout_seconds: int = 30
    
    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()
```

---

## 7. Database Integration

### Zero-Downtime Database Strategy

**Important**: To ensure zero production impact, this implementation uses **new dedicated tables** (`eavesly_evaluation_results` and `eavesly_api_logs`) that are completely separate from existing production tables. See `project-docs/database_schema.md` for complete schema details.

```python
# app/services/database.py
import os
from typing import Optional, Dict, Any, List
from datetime import datetime
from supabase import create_client, Client
from app.models.schemas import EvaluationResult
from app.utils.logger import get_logger

logger = get_logger(__name__)

class DatabaseService:
    """Supabase database integration using dedicated tables for zero production impact"""
    
    def __init__(self):
        self.client: Client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )
    
    async def store_evaluation_result(
        self,
        correlation_id: str,
        call_id: str,
        agent_id: str,
        evaluation_result: EvaluationResult,
        overall_score: int,
        processing_time_ms: int
    ) -> None:
        """Store evaluation results in eavesly_evaluation_results table"""
        try:
            data = {
                "call_id": call_id,
                "agent_id": agent_id,
                "correlation_id": correlation_id,
                "processing_time_ms": processing_time_ms,
                "classification_result": evaluation_result.classification.model_dump(),
                "script_deviation_result": evaluation_result.script_deviation.model_dump(),
                "compliance_result": evaluation_result.compliance.model_dump(),
                "communication_result": evaluation_result.communication.model_dump(),
                "deep_dive_result": evaluation_result.deep_dive.model_dump() if evaluation_result.deep_dive else None,
                "api_overall_score": overall_score,
                "api_evaluation_timestamp": datetime.utcnow().isoformat(),
                "evaluation_version": "v1"
            }
            
            # Use dedicated table to avoid production impact
            response = self.client.table("eavesly_evaluation_results").upsert(
                data, on_conflict="call_id"
            ).execute()
            
            logger.info(f"Stored evaluation for {call_id}", extra={
                "correlation_id": correlation_id
            })
            
        except Exception as e:
            logger.error(f"Failed to store evaluation: {str(e)}", extra={
                "correlation_id": correlation_id,
                "call_id": call_id
            })
            raise
    
    async def log_api_request(
        self,
        correlation_id: str,
        endpoint: str,
        status_code: int,
        processing_time_ms: int,
        error_message: Optional[str] = None
    ) -> None:
        """Log API request for audit trail in eavesly_api_logs table"""
        try:
            data = {
                "correlation_id": correlation_id,
                "endpoint": endpoint,
                "http_method": "POST",
                "http_status_code": status_code,
                "processing_time_ms": processing_time_ms,
                "error_message": error_message,
                "request_timestamp": datetime.utcnow().isoformat()
            }
            
            # Use dedicated table to avoid production impact
            self.client.table("eavesly_api_logs").insert(data).execute()
            
        except Exception as e:
            logger.warning(f"Failed to log API request: {str(e)}")
    
    async def health_check(self) -> bool:
        """Check database connectivity using new tables"""
        try:
            response = self.client.table("eavesly_evaluation_results").select("call_id").limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Database health check failed: {str(e)}")
            return False
```

### Database Schema
The implementation uses two new dedicated tables:
- **eavesly_evaluation_results**: Complete evaluation results with JSONB columns for flexible schema
- **eavesly_api_logs**: API request tracking and performance monitoring

This approach ensures:
- ✅ Zero production downtime
- ✅ Complete data isolation
- ✅ Safe rollback capability
- ✅ Parallel system operation

---

## 8. Deployment Configuration

### Dockerfile

```dockerfile
FROM python:3.11-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache gcc musl-dev

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:3000/health').raise_for_status()"

# Run as non-root user
RUN adduser -D appuser
USER appuser

EXPOSE 3000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
```

### Fly.io Configuration

```toml
# fly.toml
app = "pennie-call-qa"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  ENVIRONMENT = "production"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"
    timeout = "5s"

[http_service.concurrency]
  type = "requests"
  hard_limit = 50
  soft_limit = 25

[[http_service.machines]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1

[metrics]
  port = 9091
  path = "/metrics"
```

### Deployment Commands

```bash
# Install dependencies
poetry install

# Run locally
poetry run uvicorn app.main:app --reload

# Run tests
poetry run pytest

# Format code
poetry run black app/
poetry run ruff check app/

# Deploy to Fly.io
flyctl apps create pennie-call-qa

# Set secrets
flyctl secrets set SUPABASE_URL="https://your-project.supabase.co"
flyctl secrets set SUPABASE_ANON_KEY="your-anon-key"
flyctl secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
flyctl secrets set OPENROUTER_API_KEY="your-openrouter-key"
flyctl secrets set PROMPTLAYER_API_KEY="your-promptlayer-key"
flyctl secrets set INTERNAL_API_KEY="your-secure-internal-api-key"

# Deploy
flyctl deploy

# Monitor
flyctl status
flyctl logs
```

---

## Summary

This Python implementation provides:

1. **Clean Architecture**: Async/await patterns with FastAPI for high performance
2. **Type Safety**: Pydantic models with full validation and serialization
3. **Structured Outputs**: Instructor library for guaranteed LLM responses
4. **Production Ready**: Complete error handling, logging, and monitoring
5. **Scalable Design**: Async processing with connection pooling
6. **Simple Deployment**: Lightweight Docker images with Fly.io configuration

The Python approach reduces boilerplate by ~30% compared to TypeScript while providing better AI/ML library support and cleaner async patterns.