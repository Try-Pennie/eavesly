"""
LLM client with structured output support using Instructor.

Handles communication with OpenRouter API for structured responses.
"""

from typing import TYPE_CHECKING, Any, Optional, TypeVar

import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.models.schemas import (
        CallClassification,
        Communication,
        Compliance,
        ScriptAdherence,
    )

logger = get_logger(__name__)

T = TypeVar('T', bound=BaseModel)


class StructuredLLMClient:
    """OpenRouter client with Instructor for structured outputs"""

    def __init__(self):
        """Initialize the client with OpenRouter and Instructor configuration"""
        self.api_key = settings.openrouter_api_key
        self.model = settings.openrouter_model
        self.max_retries = settings.max_retries
        self.timeout = settings.timeout_seconds

        # Initialize OpenAI client with OpenRouter configuration
        openai_client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=self.api_key,
            timeout=self.timeout,
            default_headers={
                "HTTP-Referer": "https://trypennie.com",
                "X-Title": "Pennie Call QA System"
            }
        )

        # Wrap with Instructor for structured outputs
        self.client = instructor.from_openai(
            openai_client,
            mode=instructor.Mode.JSON
        )

        logger.info("StructuredLLMClient initialized", extra={
            "model": self.model,
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout
        })

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((Exception,))
    )
    async def get_structured_response(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000
    ) -> T:
        """
        Get structured response using Instructor library with retry logic

        Args:
            response_model: Pydantic model class for response validation
            system_prompt: System prompt for context
            user_prompt: User prompt with the actual request
            temperature: Model temperature (0.0-1.0)
            max_tokens: Maximum tokens in response

        Returns:
            Instance of response_model with validated data

        Raises:
            ValueError: If API key is missing or invalid
            TimeoutError: If request times out
            Exception: For other API or network errors
        """
        try:
            logger.info(
                f"Requesting structured response for {response_model.__name__}",
                extra={
                    "model": self.model,
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
            )

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_model=response_model,
                temperature=temperature,
                max_tokens=max_tokens
            )

            logger.info(
                f"Successfully received {response_model.__name__} response"
            )
            return response

        except Exception as e:
            logger.error(
                f"Error getting structured response for "
                f"{response_model.__name__}: {str(e)}",
                exc_info=True
            )
            raise

    async def get_structured_response_with_template(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        response_format: Optional[dict] = None,
        temperature: float = 0.3
    ) -> T:
        """
        Get structured response with pre-rendered prompt templates.
        Used for PromptLayer integration.

        Args:
            response_model: Pydantic model class for response validation
            system_prompt: Pre-rendered system prompt
            user_prompt: Pre-rendered user prompt
            response_format: Optional response format hints (unused)
            temperature: Model temperature (0.0-1.0)

        Returns:
            Instance of response_model with validated data
        """
        logger.debug(
            f"Using template-based request for {response_model.__name__}"
        )

        # Delegate to the main method since Instructor handles
        # structured output automatically
        return await self.get_structured_response(
            response_model=response_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=2000
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((Exception,))
    )
    async def get_structured_response_from_llm_kwargs(
        self,
        response_model: type[T],
        llm_kwargs: dict[str, Any]
    ) -> T:
        """
        Get structured response using llm_kwargs from PromptLayer.
        
        This method accepts the complete llm_kwargs dictionary returned by PromptLayer
        and passes it directly to OpenRouter via the Instructor client.

        Args:
            response_model: Pydantic model class for response validation
            llm_kwargs: Complete kwargs from PromptLayer (model, messages, temperature, etc.)

        Returns:
            Instance of response_model with validated data

        Raises:
            ValueError: If llm_kwargs is missing required fields
            TimeoutError: If request times out
            Exception: For other API or network errors
        """
        try:
            # Validate required fields
            required_fields = ["model", "messages"]
            for field in required_fields:
                if field not in llm_kwargs:
                    raise ValueError(f"llm_kwargs missing required field: {field}")

            logger.info(
                f"Requesting structured response using PromptLayer llm_kwargs for {response_model.__name__}",
                extra={
                    "model": llm_kwargs.get("model"),
                    "messages_count": len(llm_kwargs.get("messages", [])),
                    "temperature": llm_kwargs.get("temperature"),
                    "max_tokens": llm_kwargs.get("max_tokens")
                }
            )

            # Use llm_kwargs directly with Instructor, adding response_model
            response = await self.client.chat.completions.create(
                response_model=response_model,
                **llm_kwargs
            )

            logger.info(
                f"Successfully received {response_model.__name__} response from PromptLayer llm_kwargs"
            )
            return response

        except Exception as e:
            logger.error(
                f"Error getting structured response from llm_kwargs for "
                f"{response_model.__name__}: {str(e)}",
                exc_info=True
            )
            raise


class FallbackManager:
    """Manages fallback responses for failed evaluations"""

    def __init__(self):
        """Initialize fallback strategies for different evaluation types"""
        self.fallback_strategies = {
            "CallClassification": self._classification_fallback,
            "Compliance": self._compliance_fallback,
            "Communication": self._communication_fallback,
            "ScriptAdherence": self._script_adherence_fallback
        }
        logger.info("FallbackManager initialized with strategies", extra={
            "strategies": list(self.fallback_strategies.keys())
        })

    def _classification_fallback(self) -> 'CallClassification':
        """Generate fallback CallClassification response"""
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

    def _compliance_fallback(self) -> 'Compliance':
        """Generate fallback Compliance response"""
        from app.models.schemas import Compliance, ComplianceSummary
        return Compliance(
            items=[],
            summary=ComplianceSummary(
                no_infraction=[],
                coaching_needed=[],
                violations=["Manual review required due to evaluation failure"],
                not_applicable=[]
            )
        )

    def _communication_fallback(self) -> 'Communication':
        """Generate fallback Communication response"""
        from app.models.schemas import Communication, CommunicationSummary
        return Communication(
            skills=[],
            summary=CommunicationSummary(
                exceeded=[],
                met=[],
                missed=["Manual evaluation required due to system failure"]
            )
        )

    def _script_adherence_fallback(self) -> 'ScriptAdherence':
        """Generate fallback ScriptAdherence response"""
        from app.models.schemas import ScriptAdherence
        return ScriptAdherence(sections={})

    async def get_fallback(self, schema_name: str) -> Any:
        """
        Get fallback response for failed evaluation

        Args:
            schema_name: Name of the schema class (e.g., "CallClassification")

        Returns:
            Fallback instance of the requested schema

        Raises:
            ValueError: If no fallback strategy exists for the schema
        """
        if schema_name not in self.fallback_strategies:
            available_strategies = list(self.fallback_strategies.keys())
            logger.error(f"No fallback strategy for {schema_name}", extra={
                "available_strategies": available_strategies
            })
            raise ValueError(
                f"No fallback strategy for {schema_name}. "
                f"Available: {available_strategies}"
            )

        logger.warning(f"Using fallback response for {schema_name}")
        fallback_response = self.fallback_strategies[schema_name]()

        logger.info(f"Generated fallback for {schema_name}", extra={
            "fallback_type": type(fallback_response).__name__
        })

        return fallback_response
