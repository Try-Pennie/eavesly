"""
PromptLayer integration for prompt template management.

Fetches and manages prompt templates for LLM evaluations.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Any, Optional, Union

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.utils.logger import get_structured_logger


class PromptLayerError(Exception):
    """Base exception for PromptLayer operations"""
    pass


class PromptLayerAPIError(PromptLayerError):
    """Exception raised for PromptLayer API errors"""
    def __init__(
        self, status_code: int, message: str, response_data: Optional[dict] = None
    ):
        self.status_code = status_code
        self.message = message
        self.response_data = response_data or {}
        super().__init__(f"PromptLayer API error {status_code}: {message}")


class PromptLayerValidationError(PromptLayerError):
    """Exception raised for template validation errors"""
    pass


class PromptLayerClient:
    """Client for fetching prompt templates from PromptLayer"""

    def __init__(self, api_key: Optional[str] = None, cache_ttl_minutes: int = 60):
        """
        Initialize PromptLayer client.

        Args:
            api_key: PromptLayer API key, defaults to PROMPTLAYER_API_KEY env var
            cache_ttl_minutes: Cache TTL for templates in minutes
        """
        self.api_key = api_key or os.getenv("PROMPTLAYER_API_KEY")
        if not self.api_key:
            raise PromptLayerError("PromptLayer API key is required")

        self.base_url = "https://api.promptlayer.com"
        self.cache_ttl = timedelta(minutes=cache_ttl_minutes)
        self.templates_cache: dict[str, dict[str, Any]] = {}
        self.cache_timestamps: dict[str, datetime] = {}
        self.logger = get_structured_logger(__name__)

        # Initialize HTTP client
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "X-API-KEY": self.api_key,
                "Content-Type": "application/json"
            },
            timeout=30.0
        )

    def _is_cache_valid(self, template_name: str) -> bool:
        """Check if cached template is still valid"""
        if template_name not in self.cache_timestamps:
            return False

        cache_time = self.cache_timestamps[template_name]
        return datetime.utcnow() - cache_time < self.cache_ttl

    def _cache_template(
        self, template_name: str, template_data: dict[str, Any]
    ) -> None:
        """Cache template data with timestamp"""
        self.templates_cache[template_name] = template_data
        self.cache_timestamps[template_name] = datetime.utcnow()

        self.logger.debug(
            "Cached template",
            extra={
                "template_name": template_name,
                "cache_size": len(self.templates_cache)
            }
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        reraise=True
    )
    async def execute_prompt_template(
        self, prompt_name: str, input_variables: dict[str, Any], 
        label: str = "prod", version: Optional[int] = None
    ) -> dict[str, Any]:
        """
        Execute prompt template with input variables using PromptLayer REST API.
        
        This method calls PromptLayer's API to render the template with the provided
        variables and returns the full response, which includes llm_kwargs that can
        be passed directly to OpenRouter.

        Args:
            prompt_name: Name of the prompt template
            input_variables: Variables to substitute in the template
            label: Environment label (default: "prod")
            version: Specific version to use (defaults to latest)

        Returns:
            Full PromptLayer API response containing:
            - llm_kwargs: Complete parameters for OpenRouter (model, messages, temperature, etc.)
            - metadata: Template version, execution details, etc.

        Raises:
            PromptLayerAPIError: When API request fails
            PromptLayerValidationError: When input data is invalid
        """
        cache_key = f"{prompt_name}:v{version}" if version else prompt_name

        # Prepare API request - POST to execute template
        endpoint = f"/prompt-templates/{prompt_name}"
        payload = {
            "label": label,
            "input_variables": input_variables
        }
        if version:
            payload["version"] = version

        try:
            self.logger.info(
                "Executing template via PromptLayer",
                extra={
                    "template_name": prompt_name, 
                    "version": version,
                    "label": label,
                    "input_vars": list(input_variables.keys())
                }
            )

            response = await self.client.post(endpoint, json=payload)

            if response.status_code == 404:
                raise PromptLayerAPIError(
                    404,
                    f"Template '{prompt_name}' not found",
                    {"template_name": prompt_name, "version": version}
                )

            if not response.is_success:
                error_data = {}
                try:
                    error_data = response.json()
                except Exception:
                    error_data = {"raw_response": response.text}

                raise PromptLayerAPIError(
                    response.status_code,
                    f"Failed to execute template: "
                    f"{error_data.get('error', 'Unknown error')}",
                    error_data
                )

            result_data = response.json()

            self.logger.info(
                "Successfully executed template",
                extra={
                    "template_name": prompt_name,
                    "version": version,
                    "response_size": len(str(result_data))
                }
            )

            return result_data

        except httpx.RequestError as e:
            self.logger.error(
                "Network error executing template",
                extra={"template_name": prompt_name, "error": str(e)},
                exc_info=True
            )
            raise PromptLayerAPIError(0, f"Network error: {str(e)}") from e

        except PromptLayerAPIError:
            raise

        except Exception as e:
            self.logger.error(
                "Unexpected error executing template",
                extra={"template_name": prompt_name, "error": str(e)},
                exc_info=True
            )
            raise PromptLayerError(f"Unexpected error: {str(e)}") from e

    def extract_llm_kwargs(self, promptlayer_response: dict[str, Any]) -> dict[str, Any]:
        """
        Extract llm_kwargs from PromptLayer response for direct use with OpenRouter.
        
        Args:
            promptlayer_response: Full response from PromptLayer execute_prompt_template
            
        Returns:
            llm_kwargs dictionary ready for OpenRouter API
            
        Raises:
            PromptLayerValidationError: If response doesn't contain expected llm_kwargs
        """
        if not isinstance(promptlayer_response, dict):
            raise PromptLayerValidationError(
                f"Expected dict response, got {type(promptlayer_response)}"
            )
            
        if "llm_kwargs" not in promptlayer_response:
            raise PromptLayerValidationError(
                "PromptLayer response missing 'llm_kwargs' field"
            )
            
        llm_kwargs = promptlayer_response["llm_kwargs"]
        
        # Validate required fields for OpenRouter
        required_fields = ["model", "messages"]
        for field in required_fields:
            if field not in llm_kwargs:
                raise PromptLayerValidationError(
                    f"llm_kwargs missing required field: {field}"
                )
                
        self.logger.debug(
            "Extracted llm_kwargs from PromptLayer response",
            extra={
                "model": llm_kwargs.get("model"),
                "messages_count": len(llm_kwargs.get("messages", [])),
                "has_temperature": "temperature" in llm_kwargs,
                "has_max_tokens": "max_tokens" in llm_kwargs
            }
        )
        
        return llm_kwargs

    async def fetch_prompt_template(
        self, prompt_name: str, version: Optional[int] = None
    ) -> dict[str, Any]:
        """
        Fetch prompt template from PromptLayer REST API.
        This retrieves the template structure without executing it.

        Args:
            prompt_name: Name of the prompt template
            version: Specific version to fetch (defaults to latest)

        Returns:
            Template data including prompt text and metadata

        Raises:
            PromptLayerAPIError: When API request fails
        """
        cache_key = f"{prompt_name}:v{version}" if version else prompt_name

        # Check cache first
        if self._is_cache_valid(cache_key):
            self.logger.debug(
                "Retrieved template from cache",
                extra={"template_name": prompt_name, "version": version}
            )
            return self.templates_cache[cache_key]

        # Prepare API request - POST to fetch template
        endpoint = f"/prompt-templates/{prompt_name}"
        payload = {
            "label": "prod"  # Default label to fetch template
        }
        if version:
            payload["version"] = version

        try:
            self.logger.info(
                "Fetching template from PromptLayer",
                extra={"template_name": prompt_name, "version": version}
            )

            response = await self.client.post(endpoint, json=payload)

            if response.status_code == 404:
                raise PromptLayerAPIError(
                    404,
                    f"Template '{prompt_name}' not found",
                    {"template_name": prompt_name, "version": version}
                )

            if not response.is_success:
                error_data = {}
                try:
                    error_data = response.json()
                except Exception:
                    error_data = {"raw_response": response.text}

                raise PromptLayerAPIError(
                    response.status_code,
                    f"Failed to fetch template: "
                    f"{error_data.get('error', 'Unknown error')}",
                    error_data
                )

            template_data = response.json()

            # Validate template structure
            self._validate_template_data(template_data, prompt_name)

            # Cache the template
            self._cache_template(cache_key, template_data)

            self.logger.info(
                "Successfully fetched and cached template",
                extra={
                    "template_name": prompt_name,
                    "version": template_data.get("version"),
                    "template_id": template_data.get("id")
                }
            )

            return template_data

        except httpx.RequestError as e:
            self.logger.error(
                "Network error fetching template",
                extra={"template_name": prompt_name, "error": str(e)},
                exc_info=True
            )
            raise PromptLayerAPIError(0, f"Network error: {str(e)}") from e

        except PromptLayerAPIError:
            raise

        except Exception as e:
            self.logger.error(
                "Unexpected error fetching template",
                extra={"template_name": prompt_name, "error": str(e)},
                exc_info=True
            )
            raise PromptLayerError(f"Unexpected error: {str(e)}") from e

    def _validate_template_data(
        self, template_data: dict[str, Any], template_name: str
    ) -> None:
        """
        Validate template data structure from PromptLayer API.

        Args:
            template_data: Template data from API
            template_name: Name of template for error reporting

        Raises:
            PromptLayerValidationError: If template data is invalid
        """
        # PromptLayer API returns these fields
        required_fields = ["prompt_template", "id", "prompt_name"]

        for field in required_fields:
            if field not in template_data:
                raise PromptLayerValidationError(
                    f"Template '{template_name}' missing required field: {field}"
                )

        # Validate prompt template structure based on type
        prompt_template = template_data["prompt_template"]

        if isinstance(prompt_template, str):
            # Simple string template
            if not prompt_template.strip():
                raise PromptLayerValidationError(
                    f"Template '{template_name}' has empty prompt text"
                )

        elif isinstance(prompt_template, list):
            # Chat format with messages
            for i, message in enumerate(prompt_template):
                if not isinstance(message, dict):
                    raise PromptLayerValidationError(
                        f"Template '{template_name}' message {i} must be a dictionary"
                    )

                if "role" not in message or "content" not in message:
                    raise PromptLayerValidationError(
                        f"Template '{template_name}' message {i} must have "
                        "'role' and 'content'"
                    )

        elif isinstance(prompt_template, dict):
            # Other structured formats - basic validation
            if not prompt_template:
                raise PromptLayerValidationError(
                    f"Template '{template_name}' has empty prompt structure"
                )

        else:
            raise PromptLayerValidationError(
                f"Template '{template_name}' has unsupported prompt format: "
                f"{type(prompt_template)}"
            )

    def render_template(
        self, template: Union[str, list, dict], variables: dict[str, Any]
    ) -> Union[str, list, dict]:
        """
        Replace template variables with actual values.

        Args:
            template: Template string, list of messages, or structured template
            variables: Dictionary of variable values

        Returns:
            Rendered template with variables substituted

        Raises:
            PromptLayerValidationError: When required variables are missing
        """
        try:
            if isinstance(template, str):
                return self._render_string_template(template, variables)

            elif isinstance(template, list):
                # Chat format - render each message
                return [
                    {
                        **message,
                        "content": self._render_string_template(
                            str(message.get("content", "")), variables
                        )
                    }
                    for message in template
                ]

            elif isinstance(template, dict):
                # Structured template - recursively render string values
                return self._render_dict_template(template, variables)

            else:
                self.logger.warning(
                    "Unsupported template type for rendering",
                    extra={"template_type": type(template).__name__}
                )
                return template

        except Exception as e:
            self.logger.error(
                "Error rendering template",
                extra={"error": str(e), "variables": list(variables.keys())},
                exc_info=True
            )
            raise PromptLayerValidationError(
                f"Template rendering failed: {str(e)}"
            ) from e

    def _render_string_template(
        self, template: str, variables: dict[str, Any]
    ) -> str:
        """Render a string template with variable substitution"""
        rendered = template

        for key, value in variables.items():
            placeholder = f"{{{{{key}}}}}"

            # Handle complex values (lists, dicts) by JSON serialization
            if isinstance(value, (dict, list)):
                value_str = json.dumps(value, ensure_ascii=False, indent=2)
            else:
                value_str = str(value)

            rendered = rendered.replace(placeholder, value_str)

        # Check for remaining unsubstituted variables
        import re
        remaining_vars = re.findall(r'\{\{(\w+)\}\}', rendered)
        if remaining_vars:
            self.logger.warning(
                "Template has unsubstituted variables",
                extra={
                    "remaining_variables": remaining_vars,
                    "provided_variables": list(variables.keys())
                }
            )

        return rendered

    def _render_dict_template(
        self, template: dict, variables: dict[str, Any]
    ) -> dict:
        """Recursively render dictionary template"""
        rendered = {}

        for key, value in template.items():
            if isinstance(value, str):
                rendered[key] = self._render_string_template(value, variables)
            elif isinstance(value, dict):
                rendered[key] = self._render_dict_template(value, variables)
            elif isinstance(value, list):
                rendered[key] = [
                    (
                        self._render_string_template(str(item), variables)
                        if isinstance(item, str)
                        else self._render_dict_template(item, variables)
                        if isinstance(item, dict)
                        else item
                    )
                    for item in value
                ]
            else:
                rendered[key] = value

        return rendered

    def clear_cache(self, template_name: Optional[str] = None) -> None:
        """
        Clear template cache.

        Args:
            template_name: Specific template to clear, or None to clear all
        """
        if template_name:
            # Clear specific template and its versions
            keys_to_remove = [
                key for key in self.templates_cache.keys()
                if key == template_name or key.startswith(f"{template_name}:v")
            ]

            for key in keys_to_remove:
                self.templates_cache.pop(key, None)
                self.cache_timestamps.pop(key, None)

            self.logger.info(
                "Cleared cache for template",
                extra={
                    "template_name": template_name,
                    "keys_removed": len(keys_to_remove),
                }
            )
        else:
            # Clear all cache
            cache_size = len(self.templates_cache)
            self.templates_cache.clear()
            self.cache_timestamps.clear()

            self.logger.info(
                "Cleared all template cache",
                extra={"templates_cleared": cache_size}
            )

    def get_cache_stats(self) -> dict[str, Any]:
        """Get cache statistics"""
        now = datetime.utcnow()
        valid_count = sum(
            1 for timestamp in self.cache_timestamps.values()
            if now - timestamp < self.cache_ttl
        )

        return {
            "total_cached": len(self.templates_cache),
            "valid_cached": valid_count,
            "expired_cached": len(self.templates_cache) - valid_count,
            "cache_ttl_minutes": self.cache_ttl.total_seconds() / 60
        }

    async def close(self) -> None:
        """Close HTTP client"""
        if self.client:
            await self.client.aclose()
            self.logger.debug("Closed PromptLayer HTTP client")

