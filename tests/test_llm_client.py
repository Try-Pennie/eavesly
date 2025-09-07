"""
Unit tests for the LLM client and fallback manager.

Tests cover:
- StructuredLLMClient initialization and methods
- FallbackManager strategies and responses
- Retry logic and error handling
- Pydantic model validation
"""

import pytest
import pytest_asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from pydantic import BaseModel, ValidationError
from typing import List, Dict, Any

from app.services.llm_client import StructuredLLMClient, FallbackManager
from app.models.schemas import (
    CallClassification, CallOutcome, AdherenceLevel,
    Compliance, ComplianceSummary, ComplianceStatus,
    Communication, CommunicationSummary, PerformanceRating,
    ScriptAdherence, SectionEvaluation
)


# Test Pydantic models
class TestResponseModel(BaseModel):
    """Simple test model for validation"""
    message: str
    score: int
    tags: List[str] = []


class ComplexTestResponseModel(BaseModel):
    """Complex test model with nested structures"""
    summary: Dict[str, Any]
    items: List[Dict[str, str]]
    metadata: Dict[str, int]


class TestStructuredLLMClient:
    """Test cases for StructuredLLMClient"""

    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    def test_init(self, mock_async_openai, mock_instructor, mock_settings):
        """Test client initialization"""
        # Setup mock settings
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 3
        mock_settings.timeout_seconds = 30
        
        # Setup mocks
        mock_openai_client = Mock()
        mock_async_openai.return_value = mock_openai_client
        mock_instructor_client = Mock()
        mock_instructor.return_value = mock_instructor_client
        
        # Initialize client
        client = StructuredLLMClient()
        
        # Verify OpenAI client was created with correct parameters
        mock_async_openai.assert_called_once_with(
            base_url="https://openrouter.ai/api/v1",
            api_key="test-api-key",
            timeout=30,
            default_headers={
                "HTTP-Referer": "https://trypennie.com",
                "X-Title": "Pennie Call QA System"
            }
        )
        
        # Verify Instructor wrapper was created
        mock_instructor.assert_called_once_with(
            mock_openai_client,
            mode=mock_instructor.Mode.JSON
        )
        
        # Verify client attributes
        assert client.api_key == "test-api-key"
        assert client.model == "test-model"
        assert client.max_retries == 3
        assert client.timeout == 30
        assert client.client == mock_instructor_client

    @pytest.mark.asyncio
    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    async def test_get_structured_response_success(self, mock_async_openai, mock_instructor, mock_settings):
        """Test successful structured response"""
        # Setup mocks
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 3
        mock_settings.timeout_seconds = 30
        
        mock_response = TestResponseModel(
            message="Test response",
            score=85,
            tags=["test", "success"]
        )
        
        mock_instructor_client = AsyncMock()
        mock_instructor_client.chat.completions.create.return_value = mock_response
        mock_instructor.return_value = mock_instructor_client
        
        # Initialize and test
        client = StructuredLLMClient()
        result = await client.get_structured_response(
            response_model=TestResponseModel,
            system_prompt="You are a test assistant",
            user_prompt="Generate a test response",
            temperature=0.5,
            max_tokens=1000
        )
        
        # Verify the call
        mock_instructor_client.chat.completions.create.assert_called_once_with(
            model="test-model",
            messages=[
                {"role": "system", "content": "You are a test assistant"},
                {"role": "user", "content": "Generate a test response"}
            ],
            response_model=TestResponseModel,
            temperature=0.5,
            max_tokens=1000
        )
        
        # Verify the result
        assert result == mock_response
        assert result.message == "Test response"
        assert result.score == 85
        assert result.tags == ["test", "success"]

    @pytest.mark.asyncio
    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    async def test_get_structured_response_with_template(self, mock_async_openai, mock_instructor, mock_settings):
        """Test template-based structured response"""
        # Setup mocks
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 3
        mock_settings.timeout_seconds = 30
        
        mock_response = TestResponseModel(
            message="Template response",
            score=90
        )
        
        mock_instructor_client = AsyncMock()
        mock_instructor_client.chat.completions.create.return_value = mock_response
        mock_instructor.return_value = mock_instructor_client
        
        # Initialize and test
        client = StructuredLLMClient()
        result = await client.get_structured_response_with_template(
            response_model=TestResponseModel,
            system_prompt="Pre-rendered system prompt",
            user_prompt="Pre-rendered user prompt",
            response_format={"format": "json"},
            temperature=0.2
        )
        
        # Verify it delegates to get_structured_response
        mock_instructor_client.chat.completions.create.assert_called_once_with(
            model="test-model",
            messages=[
                {"role": "system", "content": "Pre-rendered system prompt"},
                {"role": "user", "content": "Pre-rendered user prompt"}
            ],
            response_model=TestResponseModel,
            temperature=0.2,
            max_tokens=2000
        )
        
        assert result == mock_response

    @pytest.mark.asyncio
    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    async def test_get_structured_response_error_handling(self, mock_async_openai, mock_instructor, mock_settings):
        """Test error handling in structured response"""
        # Setup mocks
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 3
        mock_settings.timeout_seconds = 30
        
        mock_instructor_client = AsyncMock()
        mock_instructor_client.chat.completions.create.side_effect = Exception("API Error")
        mock_instructor.return_value = mock_instructor_client
        
        # Initialize and test error handling
        client = StructuredLLMClient()
        
        with pytest.raises(Exception) as exc_info:
            await client.get_structured_response(
                response_model=TestResponseModel,
                system_prompt="Test system prompt",
                user_prompt="Test user prompt"
            )
        
        assert "API Error" in str(exc_info.value)

    @pytest.mark.asyncio
    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    @patch('app.services.llm_client.retry')
    async def test_retry_logic(self, mock_retry_decorator, mock_async_openai, mock_instructor, mock_settings):
        """Test that retry decorator is properly configured"""
        # Setup mocks
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 3
        mock_settings.timeout_seconds = 30
        
        # Verify retry decorator is applied
        assert mock_retry_decorator.called
        
        # Check retry configuration (this tests the decorator setup)
        client = StructuredLLMClient()
        assert hasattr(client.get_structured_response, '__wrapped__')


class TestFallbackManager:
    """Test cases for FallbackManager"""

    def test_init(self):
        """Test FallbackManager initialization"""
        manager = FallbackManager()
        
        expected_strategies = [
            "CallClassification",
            "Compliance", 
            "Communication",
            "ScriptAdherence"
        ]
        
        assert list(manager.fallback_strategies.keys()) == expected_strategies
        assert len(manager.fallback_strategies) == 4

    def test_classification_fallback(self):
        """Test CallClassification fallback response"""
        manager = FallbackManager()
        result = manager._classification_fallback()
        
        assert isinstance(result, CallClassification)
        assert result.call_outcome == CallOutcome.INCOMPLETE
        assert result.sections_completed == []
        assert result.sections_attempted == []
        assert result.script_adherence_preview == {}
        assert "Evaluation failed - manual review required" in result.red_flags
        assert result.requires_deep_dive is True
        assert result.early_termination_justified is False

    def test_compliance_fallback(self):
        """Test Compliance fallback response"""
        manager = FallbackManager()
        result = manager._compliance_fallback()
        
        assert isinstance(result, Compliance)
        assert result.items == []
        assert isinstance(result.summary, ComplianceSummary)
        assert result.summary.no_infraction == []
        assert result.summary.coaching_needed == []
        assert result.summary.not_applicable == []
        assert "Manual review required due to evaluation failure" in result.summary.violations

    def test_communication_fallback(self):
        """Test Communication fallback response"""
        manager = FallbackManager()
        result = manager._communication_fallback()
        
        assert isinstance(result, Communication)
        assert result.skills == []
        assert isinstance(result.summary, CommunicationSummary)
        assert result.summary.exceeded == []
        assert result.summary.met == []
        assert "Manual evaluation required due to system failure" in result.summary.missed

    def test_script_adherence_fallback(self):
        """Test ScriptAdherence fallback response"""
        manager = FallbackManager()
        result = manager._script_adherence_fallback()
        
        assert isinstance(result, ScriptAdherence)
        assert result.sections == {}

    @pytest.mark.asyncio
    async def test_get_fallback_success(self):
        """Test successful fallback retrieval"""
        manager = FallbackManager()
        
        # Test each strategy
        classification_result = await manager.get_fallback("CallClassification")
        assert isinstance(classification_result, CallClassification)
        
        compliance_result = await manager.get_fallback("Compliance")
        assert isinstance(compliance_result, Compliance)
        
        communication_result = await manager.get_fallback("Communication")
        assert isinstance(communication_result, Communication)
        
        script_result = await manager.get_fallback("ScriptAdherence")
        assert isinstance(script_result, ScriptAdherence)

    @pytest.mark.asyncio
    async def test_get_fallback_invalid_schema(self):
        """Test fallback with invalid schema name"""
        manager = FallbackManager()
        
        with pytest.raises(ValueError) as exc_info:
            await manager.get_fallback("InvalidSchema")
        
        assert "No fallback strategy for InvalidSchema" in str(exc_info.value)
        assert "Available:" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_fallback_logging(self):
        """Test that fallback usage is properly logged"""
        with patch('app.services.llm_client.logger') as mock_logger:
            manager = FallbackManager()
            result = await manager.get_fallback("CallClassification")
            
            # Verify warning log for fallback usage
            mock_logger.warning.assert_called_with("Using fallback response for CallClassification")
            
            # Verify info log for successful generation
            mock_logger.info.assert_called_with("Generated fallback for CallClassification", extra={
                "fallback_type": "CallClassification"
            })


class TestIntegration:
    """Integration tests for LLM client and fallback manager working together"""

    @pytest.mark.asyncio
    @patch('app.services.llm_client.settings')
    @patch('app.services.llm_client.instructor.from_openai')
    @patch('app.services.llm_client.AsyncOpenAI')
    async def test_client_with_fallback_on_error(self, mock_async_openai, mock_instructor, mock_settings):
        """Test using fallback when client fails"""
        # Setup mocks
        mock_settings.openrouter_api_key = "test-api-key"
        mock_settings.openrouter_model = "test-model"
        mock_settings.max_retries = 1  # Reduce retries for faster test
        mock_settings.timeout_seconds = 30
        
        mock_instructor_client = AsyncMock()
        mock_instructor_client.chat.completions.create.side_effect = Exception("Network error")
        mock_instructor.return_value = mock_instructor_client
        
        # Initialize client and fallback manager
        client = StructuredLLMClient()
        fallback_manager = FallbackManager()
        
        # Try to get response, expect error
        with pytest.raises(Exception):
            await client.get_structured_response(
                response_model=TestResponseModel,
                system_prompt="Test",
                user_prompt="Test"
            )
        
        # Use fallback instead
        fallback_result = await fallback_manager.get_fallback("CallClassification")
        assert isinstance(fallback_result, CallClassification)
        assert fallback_result.requires_deep_dive is True


# Test fixtures and helpers
@pytest.fixture
def mock_settings():
    """Mock settings for testing"""
    with patch('app.services.llm_client.settings') as mock:
        mock.openrouter_api_key = "test-api-key"
        mock.openrouter_model = "test-model"
        mock.max_retries = 3
        mock.timeout_seconds = 30
        yield mock


@pytest.fixture
def sample_call_classification():
    """Sample CallClassification for testing"""
    return CallClassification(
        sections_completed=[1, 2, 3],
        sections_attempted=[1, 2, 3, 4],
        call_outcome=CallOutcome.COMPLETED,
        script_adherence_preview={
            "introduction": AdherenceLevel.HIGH,
            "needs_assessment": AdherenceLevel.MEDIUM
        },
        red_flags=[],
        requires_deep_dive=False,
        early_termination_justified=False
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])