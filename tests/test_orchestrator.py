"""
Comprehensive test suite for the CallQAOrchestrator.

Tests cover:
- Individual evaluation method functionality
- Integration testing for full orchestration flow
- Edge cases and error handling
- Pydantic schema validation
- Deep dive decision logic
"""

import pytest
import pytest_asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime
from typing import Dict, List, Any

from app.services.orchestrator import CallQAOrchestrator
from app.models.requests import (
    EvaluateCallRequest, CallContext, TranscriptData, TranscriptMetadata,
    ClientData, ScriptProgress, FinancialProfile
)
from app.models.schemas import (
    CallClassification, CallOutcome, AdherenceLevel,
    ScriptAdherence, SectionEvaluation, PerformanceRating,
    Compliance, ComplianceSummary, ComplianceStatus,
    Communication, CommunicationSummary,
    DeepDive, Finding, Severity,
    EvaluationResult
)


# Test fixtures and data
@pytest.fixture
def sample_transcript_metadata():
    """Sample transcript metadata for testing"""
    return TranscriptMetadata(
        duration=300,
        timestamp=datetime(2024, 1, 15, 10, 30, 0),
        talk_time=240,
        disposition="completed",
        campaign_name="Q1 Personal Loans"
    )


@pytest.fixture
def sample_script_progress():
    """Sample script progress for testing"""
    return ScriptProgress(
        sections_attempted=[1, 2, 3, 4, 5],
        last_completed_section=5,
        termination_reason="loan_approved",
        pitch_outcome="approved"
    )


@pytest.fixture
def sample_financial_profile():
    """Sample financial profile for testing"""
    return FinancialProfile(
        annual_income=75000.0,
        dti_ratio=0.35,
        loan_approval_status="approved",
        has_existing_debt=True
    )


@pytest.fixture
def sample_request(sample_transcript_metadata, sample_script_progress, sample_financial_profile):
    """Complete sample request for testing"""
    return EvaluateCallRequest(
        call_id="call_123",
        agent_id="agent_456", 
        call_context=CallContext.FIRST_CALL,
        transcript=TranscriptData(
            transcript="Agent: Hello, this is Sarah from Pennie. I understand you're interested in our loan services. Can I get your name?\nClient: Yes, it's John Smith.\nAgent: Great John, let me tell you about our current rates...",
            metadata=sample_transcript_metadata
        ),
        ideal_script="Section 1: Introduction and greeting\nSection 2: Needs assessment\nSection 3: Product presentation\nSection 4: Objection handling\nSection 5: Closing",
        client_data=ClientData(
            lead_id="lead_789",
            campaign_id=101,
            script_progress=sample_script_progress,
            financial_profile=sample_financial_profile
        )
    )


@pytest.fixture
def mock_llm_client():
    """Mock LLM client for testing"""
    mock_client = AsyncMock()
    return mock_client


@pytest.fixture
def mock_prompt_client():
    """Mock PromptLayer client for testing"""
    mock_client = AsyncMock()
    mock_client.render_template = Mock(side_effect=lambda template, vars: template.format(**vars))
    return mock_client


@pytest.fixture
def orchestrator(mock_llm_client, mock_prompt_client):
    """Orchestrator instance with mocked dependencies"""
    orchestrator = CallQAOrchestrator()
    orchestrator.llm_client = mock_llm_client
    orchestrator.prompt_client = mock_prompt_client
    orchestrator.initialized = True
    
    # Mock template data
    orchestrator.prompt_templates = {
        "call_qa_router_classifier": {
            "system_prompt": "System: {call_context}",
            "user_prompt": "User: {transcript}",
            "temperature": 0.3,
            "schema": CallClassification
        },
        "call_qa_script_deviation": {
            "system_prompt": "System: {actual_transcript}",
            "user_prompt": "User: {ideal_transcript}",
            "temperature": 0.3,
            "schema": ScriptAdherence
        },
        "call_qa_compliance": {
            "system_prompt": "System: {transcript}",
            "user_prompt": "User: {compliance_areas}",
            "temperature": 0.3,
            "schema": Compliance
        },
        "call_qa_communication": {
            "system_prompt": "System: {transcript}",
            "user_prompt": "User: {communication_skills}",
            "temperature": 0.3,
            "schema": Communication
        },
        "call_qa_deep_dive": {
            "system_prompt": "System: {transcript}",
            "user_prompt": "User: {red_flags}",
            "temperature": 0.3,
            "schema": DeepDive
        }
    }
    
    return orchestrator


class TestCallQAOrchestrator:
    """Test cases for CallQAOrchestrator main functionality"""
    
    @pytest.mark.asyncio
    async def test_initialization(self):
        """Test orchestrator initialization"""
        orchestrator = CallQAOrchestrator()
        assert not orchestrator.initialized
        assert orchestrator.llm_client is not None
        assert orchestrator.prompt_client is not None
        assert orchestrator.fallback_manager is not None
    
    @pytest.mark.asyncio
    async def test_classify_call_enhanced_variables(self, orchestrator, sample_request, mock_llm_client):
        """Test _classify_call method with enhanced variable mapping"""
        # Mock successful response
        mock_classification = CallClassification(
            sections_completed=[1, 2, 3, 4, 5],
            sections_attempted=[1, 2, 3, 4, 5], 
            call_outcome=CallOutcome.COMPLETED,
            script_adherence_preview={"section_1": AdherenceLevel.HIGH},
            red_flags=[],
            requires_deep_dive=False,
            early_termination_justified=True
        )
        mock_llm_client.get_structured_response.return_value = mock_classification
        
        result = await orchestrator._classify_call(sample_request)
        
        # Verify result
        assert result == mock_classification
        assert isinstance(result, CallClassification)
        
        # Verify LLM client was called with correct parameters
        mock_llm_client.get_structured_response.assert_called_once()
        call_args = mock_llm_client.get_structured_response.call_args
        assert call_args[1]["response_model"] == CallClassification
        assert "System: First Call" in call_args[1]["system_prompt"]
        assert call_args[1]["temperature"] == 0.3
    
    @pytest.mark.asyncio
    async def test_evaluate_script_adherence_section_analysis(self, orchestrator, sample_request, mock_llm_client):
        """Test _evaluate_script_adherence with section-by-section analysis"""
        # Mock classification for context
        mock_classification = CallClassification(
            sections_completed=[1, 2, 3, 4, 5],
            sections_attempted=[1, 2, 3, 4, 5],
            call_outcome=CallOutcome.COMPLETED,
            early_termination_justified=True
        )
        
        # Mock script adherence response
        mock_adherence = ScriptAdherence(
            sections={
                "1": SectionEvaluation(
                    content_accuracy=PerformanceRating.MET,
                    sequence_adherence=PerformanceRating.MET,
                    language_phrasing=PerformanceRating.EXCEEDED,
                    customization=PerformanceRating.MET
                )
            }
        )
        mock_llm_client.get_structured_response.return_value = mock_adherence
        
        result = await orchestrator._evaluate_script_adherence(sample_request, mock_classification)
        
        # Verify result
        assert result == mock_adherence
        assert isinstance(result, ScriptAdherence)
        
        # Verify comprehensive context was provided
        call_args = mock_llm_client.get_structured_response.call_args
        assert call_args[1]["response_model"] == ScriptAdherence
        assert "System: Agent: Hello" in call_args[1]["system_prompt"]  # transcript included
    
    @pytest.mark.asyncio
    async def test_evaluate_compliance_regulatory_mapping(self, orchestrator, sample_request, mock_llm_client):
        """Test _evaluate_compliance with regulatory requirement mapping"""
        # Mock compliance response
        mock_compliance = Compliance(
            items=[],
            summary=ComplianceSummary(
                no_infraction=["TCPA compliance maintained"],
                coaching_needed=["Improve disclosure timing"],
                violations=[],
                not_applicable=[]
            )
        )
        mock_llm_client.get_structured_response.return_value = mock_compliance
        
        result = await orchestrator._evaluate_compliance(sample_request)
        
        # Verify result
        assert result == mock_compliance
        assert isinstance(result, Compliance)
        
        # Verify regulatory context was included
        call_args = mock_llm_client.get_structured_response.call_args
        assert call_args[1]["response_model"] == Compliance
    
    @pytest.mark.asyncio
    async def test_evaluate_communication_skill_categories(self, orchestrator, sample_request, mock_llm_client):
        """Test _evaluate_communication with comprehensive skill categories"""
        # Mock communication response
        mock_communication = Communication(
            skills=[],
            summary=CommunicationSummary(
                exceeded=["Empathy and rapport"],
                met=["Clarity", "Professionalism"],
                missed=["Closing skills"]
            )
        )
        mock_llm_client.get_structured_response.return_value = mock_communication
        
        result = await orchestrator._evaluate_communication(sample_request)
        
        # Verify result
        assert result == mock_communication
        assert isinstance(result, Communication)
        
        # Verify skill categories were included in context
        call_args = mock_llm_client.get_structured_response.call_args
        assert call_args[1]["response_model"] == Communication
    
    @pytest.mark.asyncio
    async def test_perform_deep_dive_root_cause_analysis(self, orchestrator, sample_request, mock_llm_client):
        """Test _perform_deep_dive with root cause analysis"""
        # Mock input data
        classification = CallClassification(
            call_outcome=CallOutcome.LOST,
            red_flags=["Inappropriate pressure tactics", "Failed to disclose rates"],
            requires_deep_dive=True
        )
        compliance = Compliance(
            items=[],
            summary=ComplianceSummary(violations=["CFPB violation: Unfair practices"])
        )
        
        # Mock deep dive response
        mock_deep_dive = DeepDive(
            findings=[
                Finding(
                    issue="Aggressive sales tactics",
                    severity=Severity.HIGH,
                    evidence="Agent used pressure language",
                    recommendation="Retrain on ethical sales practices"
                )
            ],
            root_cause="Insufficient training on compliance requirements",
            customer_impact=Severity.HIGH,
            urgent_actions=["Immediate agent coaching", "Customer follow-up call"]
        )
        mock_llm_client.get_structured_response.return_value = mock_deep_dive
        
        result = await orchestrator._perform_deep_dive(sample_request, classification, compliance)
        
        # Verify result
        assert result == mock_deep_dive
        assert isinstance(result, DeepDive)
        assert len(result.findings) == 1
        assert result.customer_impact == Severity.HIGH
        
        # Verify comprehensive analysis context was provided
        call_args = mock_llm_client.get_structured_response.call_args
        assert call_args[1]["response_model"] == DeepDive
    
    def test_requires_deep_dive_decision_logic(self, orchestrator):
        """Test enhanced _requires_deep_dive decision logic"""
        # Test critical trigger: compliance violations
        classification = CallClassification(call_outcome=CallOutcome.COMPLETED)
        compliance = Compliance(
            items=[],
            summary=ComplianceSummary(violations=["TCPA violation"])
        )
        assert orchestrator._requires_deep_dive(classification, compliance) == True
        
        # Test critical trigger: explicit flag
        classification = CallClassification(
            call_outcome=CallOutcome.COMPLETED,
            requires_deep_dive=True
        )
        compliance = Compliance(items=[], summary=ComplianceSummary())
        assert orchestrator._requires_deep_dive(classification, compliance) == True
        
        # Test severity scoring
        classification = CallClassification(
            call_outcome=CallOutcome.LOST,
            red_flags=["Flag 1", "Flag 2"],
            script_adherence_preview={"section_1": AdherenceLevel.LOW, "section_2": AdherenceLevel.LOW},
            early_termination_justified=False
        )
        compliance = Compliance(
            items=[],
            summary=ComplianceSummary(coaching_needed=["Item 1", "Item 2"])
        )
        
        # Should trigger deep dive due to high severity score
        assert orchestrator._requires_deep_dive(classification, compliance) == True
        
        # Test low severity case
        classification = CallClassification(
            call_outcome=CallOutcome.COMPLETED,
            red_flags=[],
            script_adherence_preview={"section_1": AdherenceLevel.HIGH}
        )
        compliance = Compliance(items=[], summary=ComplianceSummary())
        assert orchestrator._requires_deep_dive(classification, compliance) == False
    
    def test_calculate_deep_dive_score(self, orchestrator):
        """Test deep dive scoring algorithm"""
        classification = CallClassification(
            call_outcome=CallOutcome.LOST,
            red_flags=["Flag 1", "Flag 2", "Flag 3", "Flag 4"],  # Should cap at 3 points
            script_adherence_preview={"section_1": AdherenceLevel.LOW, "section_2": AdherenceLevel.LOW},  # 2 points
            early_termination_justified=False
        )
        compliance = Compliance(
            items=[],
            summary=ComplianceSummary(coaching_needed=["Item 1", "Item 2", "Item 3", "Item 4"])  # Should cap at 2 points
        )
        
        # Expected: 3 (red flags) + 2 (script issues) + 2 (coaching) + 1 (lost call) + 1 (multiple categories) = 9
        score = orchestrator._calculate_deep_dive_score(classification, compliance)
        assert score >= 7  # Should be high score
        
        # Test low score case
        classification = CallClassification(
            call_outcome=CallOutcome.COMPLETED,
            red_flags=[],
            script_adherence_preview={"section_1": AdherenceLevel.HIGH}
        )
        compliance = Compliance(items=[], summary=ComplianceSummary())
        
        score = orchestrator._calculate_deep_dive_score(classification, compliance)
        assert score == 0
    
    @pytest.mark.asyncio
    async def test_full_evaluation_workflow(self, orchestrator, sample_request, mock_llm_client):
        """Test complete evaluation workflow integration"""
        # Mock all responses
        mock_classification = CallClassification(
            sections_completed=[1, 2, 3, 4, 5],
            call_outcome=CallOutcome.COMPLETED,
            red_flags=[],
            requires_deep_dive=False
        )
        
        mock_script_adherence = ScriptAdherence(sections={})
        mock_compliance = Compliance(items=[], summary=ComplianceSummary())
        mock_communication = Communication(skills=[], summary=CommunicationSummary())
        
        # Set up mock responses in order
        mock_llm_client.get_structured_response.side_effect = [
            mock_classification,
            mock_script_adherence,
            mock_compliance,
            mock_communication
        ]
        
        result = await orchestrator.evaluate_call(sample_request)
        
        # Verify result structure
        assert isinstance(result, EvaluationResult)
        assert result.classification == mock_classification
        assert result.script_deviation == mock_script_adherence
        assert result.compliance == mock_compliance
        assert result.communication == mock_communication
        assert result.deep_dive is None  # No deep dive required
        
        # Verify all methods were called
        assert mock_llm_client.get_structured_response.call_count == 4
    
    @pytest.mark.asyncio
    async def test_evaluation_with_deep_dive(self, orchestrator, sample_request, mock_llm_client):
        """Test evaluation workflow that triggers deep dive"""
        # Mock responses that trigger deep dive
        mock_classification = CallClassification(
            call_outcome=CallOutcome.LOST,
            red_flags=["Critical issue"],
            requires_deep_dive=True
        )
        
        mock_script_adherence = ScriptAdherence(sections={})
        mock_compliance = Compliance(
            items=[],
            summary=ComplianceSummary(violations=["Compliance violation"])
        )
        mock_communication = Communication(skills=[], summary=CommunicationSummary())
        mock_deep_dive = DeepDive(
            findings=[],
            root_cause="Test root cause",
            customer_impact=Severity.HIGH,
            urgent_actions=[]
        )
        
        # Set up mock responses
        mock_llm_client.get_structured_response.side_effect = [
            mock_classification,
            mock_script_adherence,
            mock_compliance,
            mock_communication,
            mock_deep_dive
        ]
        
        result = await orchestrator.evaluate_call(sample_request)
        
        # Verify deep dive was performed
        assert result.deep_dive == mock_deep_dive
        assert mock_llm_client.get_structured_response.call_count == 5


class TestOrchestratorHelperMethods:
    """Test cases for orchestrator helper methods"""
    
    def test_build_regulatory_context(self, orchestrator, sample_financial_profile, sample_script_progress):
        """Test regulatory context building"""
        context = orchestrator._build_regulatory_context(
            sample_financial_profile,
            sample_script_progress,
            CallContext.FIRST_CALL
        )
        
        assert "applicable_regulations" in context
        assert "TCPA" in context["applicable_regulations"]
        assert "CFPB" in context["applicable_regulations"]
        assert context["risk_level"] in ["standard", "high"]
    
    def test_assess_compliance_risk(self, orchestrator, sample_script_progress):
        """Test compliance risk assessment"""
        # High risk profile
        high_risk_profile = FinancialProfile(
            annual_income=50000.0,
            dti_ratio=0.6,  # High DTI
            loan_approval_status="denied",
            has_existing_debt=True
        )
        
        risk = orchestrator._assess_compliance_risk(high_risk_profile, sample_script_progress)
        assert risk in ["low", "medium", "high"]
        
        # Low risk profile
        low_risk_profile = FinancialProfile(
            annual_income=100000.0,
            dti_ratio=0.2,
            loan_approval_status="approved",
            has_existing_debt=False
        )
        
        risk = orchestrator._assess_compliance_risk(low_risk_profile, sample_script_progress)
        assert risk in ["low", "medium", "high"]
    
    def test_get_expected_duration(self, orchestrator):
        """Test expected duration calculation"""
        sections = [1, 2, 3, 4, 5]
        duration = orchestrator._get_expected_duration(sections)
        
        # Should be 5 sections * 210 seconds + 120 overhead = 1170 seconds
        expected = 5 * 210 + 120
        assert duration == expected
    
    def test_assess_call_pace(self, orchestrator):
        """Test call pace assessment"""
        # Normal pace
        pace = orchestrator._assess_call_pace(1000, 5)
        assert pace in ["too_fast", "appropriate", "too_slow"]
        
        # Very fast
        pace = orchestrator._assess_call_pace(300, 5)
        assert pace == "too_fast"
        
        # Very slow
        pace = orchestrator._assess_call_pace(2000, 5)
        assert pace == "too_slow"


class TestOrchestratorScoring:
    """Test cases for scoring and summary generation"""
    
    def test_calculate_overall_score(self, orchestrator):
        """Test overall score calculation"""
        # Perfect evaluation
        evaluation = EvaluationResult(
            classification=CallClassification(call_outcome=CallOutcome.COMPLETED),
            script_deviation=ScriptAdherence(sections={}),
            compliance=Compliance(items=[], summary=ComplianceSummary()),
            communication=Communication(
                skills=[],
                summary=CommunicationSummary(exceeded=["Empathy", "Clarity"])
            )
        )
        
        score = orchestrator.calculate_overall_score(evaluation)
        assert 95 <= score <= 100  # Should be high score
        
        # Poor evaluation with violations
        evaluation = EvaluationResult(
            classification=CallClassification(call_outcome=CallOutcome.LOST),
            script_deviation=ScriptAdherence(sections={}),
            compliance=Compliance(
                items=[],
                summary=ComplianceSummary(
                    violations=["TCPA violation", "CFPB violation"],
                    coaching_needed=["Disclosure", "Professional conduct"]
                )
            ),
            communication=Communication(
                skills=[],
                summary=CommunicationSummary(missed=["Empathy", "Professionalism", "Clarity"])
            )
        )
        
        score = orchestrator.calculate_overall_score(evaluation)
        assert score <= 55  # Should be low score due to violations
    
    def test_generate_summary(self, orchestrator):
        """Test evaluation summary generation"""
        evaluation = EvaluationResult(
            classification=CallClassification(
                call_outcome=CallOutcome.COMPLETED,
                red_flags=["Minor issue"]
            ),
            script_deviation=ScriptAdherence(sections={}),
            compliance=Compliance(
                items=[],
                summary=ComplianceSummary(
                    coaching_needed=["Improve disclosure timing"],
                    violations=[]
                )
            ),
            communication=Communication(
                skills=[],
                summary=CommunicationSummary(
                    exceeded=["Empathy"],
                    missed=["Closing skills"]
                )
            )
        )
        
        summary = orchestrator.generate_summary(evaluation)
        
        assert "strengths" in summary
        assert "areas_for_improvement" in summary
        assert "critical_issues" in summary
        assert len(summary["strengths"]) <= 3
        assert len(summary["areas_for_improvement"]) <= 4
        assert len(summary["critical_issues"]) <= 3


class TestOrchestratorErrorHandling:
    """Test cases for error handling and fallbacks"""
    
    @pytest.mark.asyncio
    async def test_llm_failure_fallback(self, orchestrator, sample_request, mock_llm_client):
        """Test fallback behavior when LLM calls fail"""
        # Mock LLM failure
        mock_llm_client.get_structured_response.side_effect = [
            CallClassification(call_outcome=CallOutcome.COMPLETED),  # Classification succeeds
            Exception("LLM API failure"),  # Script adherence fails
            Exception("LLM API failure"),  # Compliance fails
            Exception("LLM API failure")   # Communication fails
        ]
        
        # Mock fallback responses
        orchestrator.fallback_manager.get_fallback = AsyncMock(side_effect=[
            ScriptAdherence(sections={}),
            Compliance(items=[], summary=ComplianceSummary()),
            Communication(skills=[], summary=CommunicationSummary())
        ])
        
        result = await orchestrator.evaluate_call(sample_request)
        
        # Should still return valid result with fallbacks
        assert isinstance(result, EvaluationResult)
        assert result.classification is not None
        assert result.script_deviation is not None
        assert result.compliance is not None
        assert result.communication is not None
        
        # Verify fallbacks were called
        assert orchestrator.fallback_manager.get_fallback.call_count == 3
    
    @pytest.mark.asyncio
    async def test_deep_dive_failure_handling(self, orchestrator, sample_request, mock_llm_client):
        """Test that deep dive failures don't break the workflow"""
        # Mock responses that trigger deep dive but deep dive fails
        mock_classification = CallClassification(requires_deep_dive=True)
        mock_script_adherence = ScriptAdherence(sections={})
        mock_compliance = Compliance(
            items=[],
            summary=ComplianceSummary(violations=["Test violation"])
        )
        mock_communication = Communication(skills=[], summary=CommunicationSummary())
        
        mock_llm_client.get_structured_response.side_effect = [
            mock_classification,
            mock_script_adherence,
            mock_compliance,
            mock_communication,
            Exception("Deep dive failed")  # Deep dive fails
        ]
        
        result = await orchestrator.evaluate_call(sample_request)
        
        # Should complete successfully without deep dive
        assert isinstance(result, EvaluationResult)
        assert result.deep_dive is None  # Deep dive should be None due to failure