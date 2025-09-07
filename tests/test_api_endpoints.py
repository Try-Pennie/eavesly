"""
Comprehensive test suite for the API endpoints.

Tests cover:
- Single call evaluation endpoint functionality
- Batch evaluation endpoint functionality  
- Authentication and authorization
- Error handling and validation
- Request/response format compliance
- Correlation ID tracking
"""

import pytest
import pytest_asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import HTTPException
from datetime import datetime
from typing import Dict, List, Any
from app.models.requests import EvaluateCallRequest, CallContext, TranscriptData, TranscriptMetadata
from app.models.responses import EvaluateCallResponse, EvaluationSummary
from app.models.schemas import (
    EvaluationResult, CallClassification, ScriptAdherence, 
    Compliance, Communication, DeepDive
)


class TestAPIEndpoints:
    """Test cases for API endpoints"""
    
    @pytest.fixture
    @patch('app.main.orchestrator')
    @patch('app.main.db_service')
    def client(self, mock_db, mock_orch):
        """Create test client with mocked services"""
        from app.main import app
        return TestClient(app)
    
    @pytest.fixture
    def mock_orchestrator(self):
        """Mock orchestrator instance"""
        orchestrator = AsyncMock()
        orchestrator.initialized = True
        return orchestrator
    
    @pytest.fixture
    def mock_db_service(self):
        """Mock database service instance"""
        db_service = AsyncMock()
        return db_service
    
    @pytest.fixture
    def sample_request(self):
        """Sample evaluation request"""
        return {
            "call_id": "test_call_123",
            "agent_id": "agent_456", 
            "call_context": "inbound_sales",
            "transcript": {
                "data": [
                    {"speaker": "Agent", "text": "Hello, how can I help you today?", "timestamp": 0.0},
                    {"speaker": "Customer", "text": "I'm interested in your loan products.", "timestamp": 5.0}
                ],
                "metadata": {
                    "duration_seconds": 300,
                    "call_date": "2024-01-15T10:30:00Z"
                }
            }
        }
    
    @pytest.fixture
    def sample_evaluation_result(self):
        """Sample evaluation result from orchestrator"""
        return EvaluationResult(
            classification=CallClassification(
                sections_completed=[1, 2, 3],
                sections_attempted=[1, 2, 3],
                call_outcome="completed",
                script_adherence_preview={"introduction": "high", "needs_assessment": "medium"},
                red_flags=[],
                requires_deep_dive=False,
                early_termination_justified=False
            ),
            script_deviation=ScriptAdherence(sections={}),
            compliance=Compliance(items=[], summary={"no_infraction": [], "coaching_needed": [], "violations": [], "not_applicable": []}),
            communication=Communication(skills=[], summary={"exceeded": ["rapport"], "met": ["clarity"], "missed": []}),
            deep_dive=None
        )
    
    @pytest.fixture
    def sample_summary(self):
        """Sample evaluation summary"""
        return {
            "strengths": ["Excellent rapport building"],
            "areas_for_improvement": ["Could improve closing technique"],
            "critical_issues": []
        }
    
    @pytest.fixture
    def auth_headers(self):
        """Authentication headers"""
        return {"Authorization": "Bearer test_api_key"}


class TestSingleCallEvaluation(TestAPIEndpoints):
    """Tests for single call evaluation endpoint"""
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')
    def test_evaluate_call_success(self, mock_get_db, mock_get_orch, client, auth_headers, 
                                  sample_request, sample_evaluation_result, sample_summary):
        """Test successful call evaluation"""
        # Setup mocks
        mock_orchestrator = AsyncMock()
        mock_orchestrator.evaluate_call.return_value = sample_evaluation_result
        mock_orchestrator.calculate_overall_score.return_value = 85
        mock_orchestrator.generate_summary.return_value = sample_summary
        mock_get_orch.return_value = mock_orchestrator
        
        mock_db_service = AsyncMock()
        mock_get_db.return_value = mock_db_service
        
        # Make request
        response = client.post("/api/v1/evaluate-call", 
                              json=sample_request, 
                              headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        
        assert data["call_id"] == "test_call_123"
        assert "correlation_id" in data
        assert data["correlation_id"].startswith("eval_")
        assert data["overall_score"] == 85
        assert "processing_time_ms" in data
        assert data["summary"]["strengths"] == ["Excellent rapport building"]
        assert "evaluation" in data
        
        # Verify orchestrator was called
        mock_orchestrator.evaluate_call.assert_called_once()
        mock_orchestrator.calculate_overall_score.assert_called_once()
        mock_orchestrator.generate_summary.assert_called_once()
        
        # Verify database storage was attempted
        mock_db_service.store_evaluation_result.assert_called_once()
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    def test_evaluate_call_no_auth(self, client, sample_request):
        """Test call evaluation without authentication"""
        response = client.post("/api/v1/evaluate-call", json=sample_request)
        assert response.status_code == 403
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    def test_evaluate_call_wrong_auth(self, client, sample_request):
        """Test call evaluation with wrong API key"""
        headers = {"Authorization": "Bearer wrong_key"}
        response = client.post("/api/v1/evaluate-call", 
                              json=sample_request, 
                              headers=headers)
        assert response.status_code == 401
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')
    def test_evaluate_call_orchestrator_error(self, mock_get_db, mock_get_orch, 
                                            client, auth_headers, sample_request):
        """Test evaluation when orchestrator raises error"""
        # Setup mocks
        mock_orchestrator = AsyncMock()
        mock_orchestrator.evaluate_call.side_effect = Exception("Orchestrator error")
        mock_get_orch.return_value = mock_orchestrator
        
        mock_db_service = AsyncMock()
        mock_get_db.return_value = mock_db_service
        
        # Make request
        response = client.post("/api/v1/evaluate-call", 
                              json=sample_request, 
                              headers=auth_headers)
        
        # Assertions
        assert response.status_code == 500
        data = response.json()
        assert data["detail"]["error"] == "EVALUATION_FAILED"
        assert "correlation_id" in data["detail"]
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    def test_evaluate_call_invalid_request(self, client, auth_headers):
        """Test evaluation with invalid request data"""
        invalid_request = {"call_id": "test", "missing_required_fields": True}
        
        response = client.post("/api/v1/evaluate-call", 
                              json=invalid_request, 
                              headers=auth_headers)
        
        assert response.status_code == 422  # Validation error


class TestBatchEvaluation(TestAPIEndpoints):
    """Tests for batch evaluation endpoint"""
    
    def create_batch_request(self, count=3):
        """Helper to create batch request"""
        requests = []
        for i in range(count):
            requests.append({
                "call_id": f"test_call_{i}",
                "agent_id": f"agent_{i}",
                "call_context": "inbound_sales",
                "transcript": {
                    "data": [
                        {"speaker": "Agent", "text": f"Hello {i}", "timestamp": 0.0},
                        {"speaker": "Customer", "text": f"Response {i}", "timestamp": 5.0}
                    ],
                    "metadata": {
                        "duration_seconds": 300,
                        "call_date": "2024-01-15T10:30:00Z"
                    }
                }
            })
        return requests
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')
    def test_evaluate_batch_success(self, mock_get_db, mock_get_orch, client, auth_headers, 
                                   sample_evaluation_result, sample_summary):
        """Test successful batch evaluation"""
        # Setup mocks
        mock_orchestrator = AsyncMock()
        mock_orchestrator.evaluate_call.return_value = sample_evaluation_result
        mock_orchestrator.calculate_overall_score.return_value = 85
        mock_orchestrator.generate_summary.return_value = sample_summary
        mock_get_orch.return_value = mock_orchestrator
        
        mock_db_service = AsyncMock()
        mock_get_db.return_value = mock_db_service
        
        # Create batch request
        batch_request = self.create_batch_request(count=2)
        
        # Make request
        response = client.post("/api/v1/evaluate-batch", 
                              json=batch_request, 
                              headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        
        assert "batch_correlation_id" in data
        assert data["batch_correlation_id"].startswith("batch_")
        assert len(data["results"]) == 2
        assert data["summary"]["total"] == 2
        assert data["summary"]["successful"] == 2
        assert data["summary"]["failed"] == 0
        assert data["summary"]["success_rate"] == 1.0
        
        # Verify all calls were processed
        for result in data["results"]:
            assert result["success"] is True
            assert "response" in result
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    def test_evaluate_batch_empty(self, client, auth_headers):
        """Test batch evaluation with empty list"""
        response = client.post("/api/v1/evaluate-batch", 
                              json=[], 
                              headers=auth_headers)
        
        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["error"] == "EMPTY_BATCH"
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.config.settings.max_concurrent_evaluations', 2)
    def test_evaluate_batch_size_exceeded(self, client, auth_headers):
        """Test batch evaluation when size limit exceeded"""
        batch_request = self.create_batch_request(count=5)  # Exceeds limit of 2
        
        response = client.post("/api/v1/evaluate-batch", 
                              json=batch_request, 
                              headers=auth_headers)
        
        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["error"] == "BATCH_SIZE_EXCEEDED"
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')  
    def test_evaluate_batch_partial_failure(self, mock_get_db, mock_get_orch, client, auth_headers,
                                           sample_evaluation_result, sample_summary):
        """Test batch evaluation with some failures"""
        # Setup mocks - first call succeeds, second fails
        mock_orchestrator = AsyncMock()
        call_count = 0
        
        async def mock_evaluate_call(request):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return sample_evaluation_result
            else:
                raise Exception("Second call failed")
        
        mock_orchestrator.evaluate_call.side_effect = mock_evaluate_call
        mock_orchestrator.calculate_overall_score.return_value = 85
        mock_orchestrator.generate_summary.return_value = sample_summary
        mock_get_orch.return_value = mock_orchestrator
        
        mock_db_service = AsyncMock()
        mock_get_db.return_value = mock_db_service
        
        # Create batch request
        batch_request = self.create_batch_request(count=2)
        
        # Make request
        response = client.post("/api/v1/evaluate-batch", 
                              json=batch_request, 
                              headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        
        assert data["summary"]["total"] == 2
        assert data["summary"]["successful"] == 1
        assert data["summary"]["failed"] == 1
        assert data["summary"]["success_rate"] == 0.5
        
        # Check individual results
        success_results = [r for r in data["results"] if r["success"]]
        failure_results = [r for r in data["results"] if not r["success"]]
        
        assert len(success_results) == 1
        assert len(failure_results) == 1
        assert "error" in failure_results[0]
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    def test_evaluate_batch_no_auth(self, client):
        """Test batch evaluation without authentication"""
        batch_request = self.create_batch_request(count=1)
        response = client.post("/api/v1/evaluate-batch", json=batch_request)
        assert response.status_code == 403


class TestErrorHandling(TestAPIEndpoints):
    """Tests for error handling scenarios"""
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')
    def test_database_storage_error_handled(self, mock_get_db, mock_get_orch, 
                                          client, auth_headers, sample_request,
                                          sample_evaluation_result, sample_summary):
        """Test that database storage errors don't fail the request"""
        # Setup mocks
        mock_orchestrator = AsyncMock()
        mock_orchestrator.evaluate_call.return_value = sample_evaluation_result
        mock_orchestrator.calculate_overall_score.return_value = 85
        mock_orchestrator.generate_summary.return_value = sample_summary
        mock_get_orch.return_value = mock_orchestrator
        
        # Database service raises error but request should still succeed
        mock_db_service = AsyncMock()
        mock_db_service.store_evaluation_result.side_effect = Exception("DB error")
        mock_get_db.return_value = mock_db_service
        
        # Make request
        response = client.post("/api/v1/evaluate-call", 
                              json=sample_request, 
                              headers=auth_headers)
        
        # Should still succeed despite DB error
        assert response.status_code == 200
        data = response.json()
        assert data["call_id"] == "test_call_123"


class TestResponseValidation(TestAPIEndpoints):
    """Tests for response format validation"""
    
    @patch.dict('os.environ', {'INTERNAL_API_KEY': 'test_api_key'})
    @patch('app.api.routes.get_orchestrator')
    @patch('app.api.routes.get_db_service')
    def test_response_format_compliance(self, mock_get_db, mock_get_orch, 
                                       client, auth_headers, sample_request,
                                       sample_evaluation_result, sample_summary):
        """Test that response format matches specification"""
        # Setup mocks
        mock_orchestrator = AsyncMock()
        mock_orchestrator.evaluate_call.return_value = sample_evaluation_result
        mock_orchestrator.calculate_overall_score.return_value = 85
        mock_orchestrator.generate_summary.return_value = sample_summary
        mock_get_orch.return_value = mock_orchestrator
        
        mock_db_service = AsyncMock()
        mock_get_db.return_value = mock_db_service
        
        # Make request
        response = client.post("/api/v1/evaluate-call", 
                              json=sample_request, 
                              headers=auth_headers)
        
        # Validate response structure
        assert response.status_code == 200
        data = response.json()
        
        # Required fields
        required_fields = [
            "call_id", "correlation_id", "timestamp", 
            "processing_time_ms", "evaluation", "overall_score", "summary"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Validate field types
        assert isinstance(data["overall_score"], int)
        assert 1 <= data["overall_score"] <= 100
        assert isinstance(data["processing_time_ms"], int)
        assert data["processing_time_ms"] >= 0
        
        # Validate correlation ID format
        assert data["correlation_id"].startswith("eval_")
        
        # Validate summary structure
        summary = data["summary"]
        assert "strengths" in summary
        assert "areas_for_improvement" in summary  
        assert "critical_issues" in summary
        assert isinstance(summary["strengths"], list)
        assert isinstance(summary["areas_for_improvement"], list)
        assert isinstance(summary["critical_issues"], list)