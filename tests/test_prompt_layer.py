"""
Tests for PromptLayer integration.

Comprehensive test coverage for prompt template fetching, caching,
and rendering functionality.
"""

import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch
from typing import Dict, Any

import httpx

from app.services.prompt_layer import (
    PromptLayerClient,
    PromptLayerError,
    PromptLayerAPIError,
    PromptLayerValidationError
)


class TestPromptLayerClient:
    """Test cases for PromptLayerClient"""
    
    @pytest.fixture
    def mock_api_key(self):
        """Mock API key for testing"""
        return "test_api_key_12345"
    
    @pytest.fixture
    def client(self, mock_api_key):
        """Create test client instance"""
        with patch.dict('os.environ', {'PROMPTLAYER_API_KEY': mock_api_key}):
            client = PromptLayerClient(cache_ttl_minutes=5)
            yield client
    
    @pytest.fixture
    def sample_string_template(self):
        """Sample string template data"""
        return {
            "prompt_template": "Hello {{name}}, your score is {{score}}!",
            "version": 1,
            "type": "completion",
            "metadata": {"created_at": "2024-01-01T00:00:00Z"}
        }
    
    @pytest.fixture
    def sample_chat_template(self):
        """Sample chat template data"""
        return {
            "prompt_template": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello {{name}}, please help with {{task}}."}
            ],
            "version": 2,
            "type": "chat",
            "metadata": {"created_at": "2024-01-02T00:00:00Z"}
        }
    
    @pytest.fixture
    def sample_dict_template(self):
        """Sample dictionary template data"""
        return {
            "prompt_template": {
                "system_message": "You are evaluating {{evaluation_type}}.",
                "user_prompt": "Please rate this {{content_type}}: {{content}}",
                "instructions": ["Be objective", "Use scale {{scale}}"]
            },
            "version": 1,
            "type": "structured"
        }

    def test_init_with_api_key(self, mock_api_key):
        """Test client initialization with explicit API key"""
        client = PromptLayerClient(api_key=mock_api_key)
        assert client.api_key == mock_api_key
        assert client.base_url == "https://api.promptlayer.com/rest"
        assert isinstance(client.templates_cache, dict)
        assert isinstance(client.cache_timestamps, dict)
    
    def test_init_with_env_api_key(self, mock_api_key):
        """Test client initialization with environment variable API key"""
        with patch.dict('os.environ', {'PROMPTLAYER_API_KEY': mock_api_key}):
            client = PromptLayerClient()
            assert client.api_key == mock_api_key
    
    def test_init_without_api_key(self):
        """Test client initialization fails without API key"""
        with patch.dict('os.environ', {}, clear=True):
            with pytest.raises(PromptLayerError, match="API key is required"):
                PromptLayerClient()
    
    def test_init_with_custom_cache_ttl(self, mock_api_key):
        """Test client initialization with custom cache TTL"""
        client = PromptLayerClient(api_key=mock_api_key, cache_ttl_minutes=30)
        assert client.cache_ttl == timedelta(minutes=30)
    
    def test_cache_validation(self, client):
        """Test cache validation logic"""
        template_name = "test_template"
        
        # No cache entry
        assert not client._is_cache_valid(template_name)
        
        # Fresh cache entry
        client.cache_timestamps[template_name] = datetime.utcnow()
        assert client._is_cache_valid(template_name)
        
        # Expired cache entry
        client.cache_timestamps[template_name] = datetime.utcnow() - timedelta(minutes=10)
        assert not client._is_cache_valid(template_name)
    
    def test_cache_template(self, client, sample_string_template):
        """Test template caching"""
        template_name = "test_template"
        
        client._cache_template(template_name, sample_string_template)
        
        assert template_name in client.templates_cache
        assert client.templates_cache[template_name] == sample_string_template
        assert template_name in client.cache_timestamps
        assert isinstance(client.cache_timestamps[template_name], datetime)

    @pytest.mark.asyncio
    async def test_fetch_template_success(self, client, sample_string_template):
        """Test successful template fetching"""
        template_name = "test_template"
        
        # Mock HTTP response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = sample_string_template
        
        with patch.object(client.client, 'get', return_value=mock_response) as mock_get:
            result = await client.fetch_prompt_template(template_name)
            
            # Verify API call
            mock_get.assert_called_once_with(
                f"/prompt-templates/{template_name}",
                params={}
            )
            
            # Verify result
            assert result == sample_string_template
            
            # Verify caching
            assert template_name in client.templates_cache
            assert client._is_cache_valid(template_name)
    
    @pytest.mark.asyncio
    async def test_fetch_template_with_version(self, client, sample_string_template):
        """Test fetching template with specific version"""
        template_name = "test_template"
        version = 2
        cache_key = f"{template_name}:v{version}"
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = sample_string_template
        
        with patch.object(client.client, 'get', return_value=mock_response) as mock_get:
            result = await client.fetch_prompt_template(template_name, version=version)
            
            mock_get.assert_called_once_with(
                f"/prompt-templates/{template_name}",
                params={"version": version}
            )
            
            assert result == sample_string_template
            assert cache_key in client.templates_cache

    @pytest.mark.asyncio
    async def test_fetch_template_from_cache(self, client, sample_string_template):
        """Test fetching template from cache"""
        template_name = "test_template"
        
        # Pre-populate cache
        client._cache_template(template_name, sample_string_template)
        
        with patch.object(client.client, 'get') as mock_get:
            result = await client.fetch_prompt_template(template_name)
            
            # Should not make API call
            mock_get.assert_not_called()
            assert result == sample_string_template

    @pytest.mark.asyncio
    async def test_fetch_template_404_error(self, client):
        """Test handling of 404 error"""
        template_name = "nonexistent_template"
        
        mock_response = Mock()
        mock_response.status_code = 404
        
        with patch.object(client.client, 'get', return_value=mock_response):
            with pytest.raises(PromptLayerAPIError) as exc_info:
                await client.fetch_prompt_template(template_name)
            
            assert exc_info.value.status_code == 404
            assert "not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_fetch_template_api_error(self, client):
        """Test handling of API errors"""
        template_name = "test_template"
        
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.is_success = False
        mock_response.json.return_value = {"error": "Internal server error"}
        
        with patch.object(client.client, 'get', return_value=mock_response):
            with pytest.raises(PromptLayerAPIError) as exc_info:
                await client.fetch_prompt_template(template_name)
            
            assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_fetch_template_network_error(self, client):
        """Test handling of network errors"""
        template_name = "test_template"
        
        with patch.object(client.client, 'get', side_effect=httpx.RequestError("Connection failed")):
            with pytest.raises(PromptLayerAPIError) as exc_info:
                await client.fetch_prompt_template(template_name)
            
            assert "Network error" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_fetch_template_with_retry(self, client, sample_string_template):
        """Test retry mechanism on transient failures"""
        template_name = "test_template"
        
        # First two calls fail, third succeeds
        mock_responses = [
            httpx.RequestError("Transient error"),
            httpx.RequestError("Another transient error"),
            Mock(status_code=200, is_success=True, json=lambda: sample_string_template)
        ]
        
        with patch.object(client.client, 'get', side_effect=mock_responses):
            result = await client.fetch_prompt_template(template_name)
            assert result == sample_string_template

    def test_validate_template_data_string_template(self, client, sample_string_template):
        """Test validation of string template"""
        client._validate_template_data(sample_string_template, "test_template")  # Should not raise
    
    def test_validate_template_data_chat_template(self, client, sample_chat_template):
        """Test validation of chat template"""
        client._validate_template_data(sample_chat_template, "test_template")  # Should not raise
    
    def test_validate_template_data_dict_template(self, client, sample_dict_template):
        """Test validation of dictionary template"""
        client._validate_template_data(sample_dict_template, "test_template")  # Should not raise
    
    def test_validate_template_data_missing_field(self, client):
        """Test validation fails for missing required fields"""
        invalid_template = {"version": 1}  # Missing prompt_template
        
        with pytest.raises(PromptLayerValidationError, match="missing required field"):
            client._validate_template_data(invalid_template, "test_template")
    
    def test_validate_template_data_empty_string(self, client):
        """Test validation fails for empty string template"""
        invalid_template = {"prompt_template": "   "}
        
        with pytest.raises(PromptLayerValidationError, match="empty prompt text"):
            client._validate_template_data(invalid_template, "test_template")
    
    def test_validate_template_data_invalid_chat_message(self, client):
        """Test validation fails for invalid chat messages"""
        invalid_template = {
            "prompt_template": [
                {"role": "system", "content": "System message"},
                {"role": "user"}  # Missing content
            ]
        }
        
        with pytest.raises(PromptLayerValidationError, match="must have 'role' and 'content'"):
            client._validate_template_data(invalid_template, "test_template")
    
    def test_render_string_template_basic(self, client):
        """Test basic string template rendering"""
        template = "Hello {{name}}, your score is {{score}}!"
        variables = {"name": "Alice", "score": 95}
        
        result = client.render_template(template, variables)
        expected = "Hello Alice, your score is 95!"
        
        assert result == expected
    
    def test_render_string_template_complex_variables(self, client):
        """Test string template rendering with complex variables"""
        template = "Data: {{data}}"
        variables = {
            "data": {"items": [1, 2, 3], "total": 6}
        }
        
        result = client.render_template(template, variables)
        assert '"items": [' in result  # Allow for formatting differences
        assert '"total": 6' in result
    
    def test_render_chat_template(self, client, sample_chat_template):
        """Test chat template rendering"""
        variables = {"name": "Bob", "task": "writing an email"}
        
        result = client.render_template(sample_chat_template["prompt_template"], variables)
        
        assert len(result) == 2
        assert result[0]["role"] == "system"
        assert result[0]["content"] == "You are a helpful assistant."
        assert result[1]["role"] == "user"
        assert "Hello Bob" in result[1]["content"]
        assert "writing an email" in result[1]["content"]
    
    def test_render_dict_template(self, client, sample_dict_template):
        """Test dictionary template rendering"""
        variables = {
            "evaluation_type": "quality assessment",
            "content_type": "article",
            "content": "Sample article text",
            "scale": "1-10"
        }
        
        result = client.render_template(sample_dict_template["prompt_template"], variables)
        
        assert "quality assessment" in result["system_message"]
        assert "article" in result["user_prompt"]
        assert "Sample article text" in result["user_prompt"]
        assert "1-10" in result["instructions"][1]
    
    def test_render_template_missing_variables(self, client):
        """Test template rendering with missing variables logs warning"""
        template = "Hello {{name}}, your score is {{score}}!"
        variables = {"name": "Alice"}  # Missing score
        
        with patch.object(client.logger, 'warning') as mock_warning:
            result = client.render_template(template, variables)
            
            assert "Hello Alice" in result
            assert "{{score}}" in result  # Unsubstituted
            mock_warning.assert_called_once()
    
    def test_render_template_unsupported_type(self, client):
        """Test rendering with unsupported template type"""
        template = 42  # Unsupported type
        variables = {}
        
        with patch.object(client.logger, 'warning') as mock_warning:
            result = client.render_template(template, variables)
            assert result == 42
            mock_warning.assert_called_once()
    
    def test_clear_cache_specific_template(self, client, sample_string_template):
        """Test clearing cache for specific template"""
        template_name = "test_template"
        
        # Populate cache
        client._cache_template(template_name, sample_string_template)
        client._cache_template(f"{template_name}:v2", sample_string_template)
        client._cache_template("other_template", sample_string_template)
        
        # Clear specific template
        client.clear_cache(template_name)
        
        # Check results
        assert template_name not in client.templates_cache
        assert f"{template_name}:v2" not in client.templates_cache
        assert "other_template" in client.templates_cache
    
    def test_clear_cache_all_templates(self, client, sample_string_template):
        """Test clearing all cached templates"""
        # Populate cache
        client._cache_template("template1", sample_string_template)
        client._cache_template("template2", sample_string_template)
        
        # Clear all
        client.clear_cache()
        
        # Check results
        assert len(client.templates_cache) == 0
        assert len(client.cache_timestamps) == 0
    
    def test_get_cache_stats(self, client, sample_string_template):
        """Test cache statistics"""
        # Empty cache
        stats = client.get_cache_stats()
        assert stats["total_cached"] == 0
        assert stats["valid_cached"] == 0
        assert stats["expired_cached"] == 0
        
        # Add valid cache entry
        client._cache_template("template1", sample_string_template)
        
        # Add expired cache entry
        client._cache_template("template2", sample_string_template)
        client.cache_timestamps["template2"] = datetime.utcnow() - timedelta(hours=2)
        
        stats = client.get_cache_stats()
        assert stats["total_cached"] == 2
        assert stats["valid_cached"] == 1
        assert stats["expired_cached"] == 1
    
    @pytest.mark.asyncio
    async def test_close_client(self, client):
        """Test closing the HTTP client"""
        # Mock the client close method
        client.client.aclose = AsyncMock()
        
        await client.close()
        
        client.client.aclose.assert_called_once()


class TestPromptLayerExceptions:
    """Test exception classes"""
    
    def test_prompt_layer_error(self):
        """Test base PromptLayer exception"""
        error = PromptLayerError("Test error")
        assert str(error) == "Test error"
    
    def test_prompt_layer_api_error(self):
        """Test PromptLayer API exception"""
        response_data = {"detail": "Not found"}
        error = PromptLayerAPIError(404, "Template not found", response_data)
        
        assert error.status_code == 404
        assert error.message == "Template not found"
        assert error.response_data == response_data
        assert "404" in str(error)
        assert "Template not found" in str(error)
    
    def test_prompt_layer_validation_error(self):
        """Test PromptLayer validation exception"""
        error = PromptLayerValidationError("Invalid template format")
        assert str(error) == "Invalid template format"


class TestIntegrationScenarios:
    """Integration test scenarios"""
    
    @pytest.fixture
    def client(self):
        """Create test client for integration tests"""
        with patch.dict('os.environ', {'PROMPTLAYER_API_KEY': 'test_key'}):
            client = PromptLayerClient(cache_ttl_minutes=1)
            yield client
    
    @pytest.mark.asyncio
    async def test_full_workflow_string_template(self, client):
        """Test complete workflow with string template"""
        template_name = "evaluation_template"
        template_data = {
            "prompt_template": "Please evaluate this {{content_type}}: {{content}}\nUse criteria: {{criteria}}",
            "version": 1,
            "metadata": {"author": "test"}
        }
        variables = {
            "content_type": "email",
            "content": "Dear customer, thank you for your purchase.",
            "criteria": ["clarity", "professionalism"]
        }
        
        # Mock successful API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = template_data
        
        with patch.object(client.client, 'get', return_value=mock_response):
            # Fetch template
            fetched_template = await client.fetch_prompt_template(template_name)
            assert fetched_template == template_data
            
            # Render template
            rendered = client.render_template(
                fetched_template["prompt_template"], 
                variables
            )
            
            assert "evaluate this email" in rendered
            assert "Dear customer" in rendered
            assert "clarity" in rendered
            
            # Verify caching - second fetch should use cache
            cached_template = await client.fetch_prompt_template(template_name)
            assert cached_template == template_data

    @pytest.mark.asyncio
    async def test_full_workflow_chat_template(self, client):
        """Test complete workflow with chat template"""
        template_name = "chat_evaluation"
        template_data = {
            "prompt_template": [
                {"role": "system", "content": "You are an expert {{evaluator_type}} evaluator."},
                {"role": "user", "content": "Please evaluate: {{content}}"},
                {"role": "assistant", "content": "I'll evaluate the {{content_type}} based on {{criteria}}."}
            ],
            "version": 1
        }
        variables = {
            "evaluator_type": "call quality",
            "content": "Customer service call transcript",
            "content_type": "conversation",
            "criteria": "professionalism and helpfulness"
        }
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = template_data
        
        with patch.object(client.client, 'get', return_value=mock_response):
            fetched_template = await client.fetch_prompt_template(template_name)
            rendered = client.render_template(
                fetched_template["prompt_template"],
                variables
            )
            
            assert len(rendered) == 3
            assert "call quality evaluator" in rendered[0]["content"]
            assert "Customer service call transcript" in rendered[1]["content"]
            assert "professionalism and helpfulness" in rendered[2]["content"]

    @pytest.mark.asyncio
    async def test_error_handling_and_recovery(self, client):
        """Test error handling and recovery scenarios"""
        template_name = "flaky_template"
        template_data = {"prompt_template": "Test template"}
        
        # Simulate transient failures followed by success
        responses = [
            httpx.RequestError("Connection timeout"),
            Mock(status_code=500, is_success=False, json=lambda: {"error": "Server error"}),
            Mock(status_code=200, is_success=True, json=lambda: template_data)
        ]
        
        with patch.object(client.client, 'get', side_effect=responses):
            # Should eventually succeed despite initial failures
            result = await client.fetch_prompt_template(template_name)
            assert result == template_data
            
            # Should be cached now
            cached_result = await client.fetch_prompt_template(template_name)
            assert cached_result == template_data

    def test_cache_expiration_and_refresh(self, client):
        """Test cache expiration and refresh behavior"""
        template_name = "expiring_template"
        template_data = {"prompt_template": "Test"}
        
        # Add to cache
        client._cache_template(template_name, template_data)
        assert client._is_cache_valid(template_name)
        
        # Manually expire cache
        client.cache_timestamps[template_name] = datetime.utcnow() - timedelta(hours=1)
        assert not client._is_cache_valid(template_name)
        
        # Cache stats should reflect expiration
        stats = client.get_cache_stats()
        assert stats["expired_cached"] == 1
        assert stats["valid_cached"] == 0