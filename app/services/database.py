"""
Database service for Supabase integration.

Handles storage and retrieval of evaluation results with comprehensive
error handling, retry logic, and connection management.
"""

import os
from datetime import datetime
from typing import Any, Dict, Optional

from supabase import Client, create_client
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.utils.logger import get_structured_logger

logger = get_structured_logger(__name__)


class DatabaseService:
    """
    Supabase database integration service.
    
    Provides methods for storing evaluation results, logging API requests,
    and checking database connectivity with proper error handling.
    """

    def __init__(self):
        """Initialize Supabase client with service role key"""
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.supabase_url or not self.service_role_key:
            logger.error("Database configuration missing", extra={
                "has_url": bool(self.supabase_url),
                "has_key": bool(self.service_role_key)
            })
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured")

        try:
            self.client: Client = create_client(
                self.supabase_url,
                self.service_role_key
            )
            logger.info("Database client initialized successfully")
        except Exception as e:
            logger.error("Failed to initialize database client", extra={
                "error": str(e)
            })
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(Exception)
    )
    async def store_evaluation_result(
        self,
        correlation_id: str,
        call_id: str,
        agent_id: str,
        evaluation_result: Dict[str, Any],
        overall_score: int,
        processing_time_ms: int
    ) -> None:
        """
        Store evaluation results in eavesly_transcription_qa table.
        
        Uses upsert logic to handle duplicate call_ids and includes all
        metadata required for reporting and analysis.
        """
        try:
            # Handle both Pydantic models and dict objects
            if hasattr(evaluation_result, 'model_dump'):
                # Pydantic v2
                eval_dict = evaluation_result.model_dump()
            elif hasattr(evaluation_result, 'dict'):
                # Pydantic v1
                eval_dict = evaluation_result.dict()
            else:
                # Already a dictionary
                eval_dict = evaluation_result

            # Prepare data for insertion
            data = {
                "call_id": call_id,
                "agent_id": agent_id,
                "correlation_id": correlation_id,
                "processing_time_ms": processing_time_ms,
                "api_overall_score": overall_score,
                "api_evaluation_timestamp": datetime.utcnow().isoformat(),
                "evaluation_version": "v1",
                # Store complete evaluation result as JSON
                "classification_result": eval_dict.get("classification", {}),
                "script_deviation_result": eval_dict.get("script_deviation", {}),
                "compliance_result": eval_dict.get("compliance", {}),
                "communication_result": eval_dict.get("communication", {}),
                "deep_dive_result": eval_dict.get("deep_dive") if eval_dict.get("deep_dive") else None
            }

            logger.debug("Storing evaluation result", extra={
                "correlation_id": correlation_id,
                "call_id": call_id,
                "agent_id": agent_id,
                "overall_score": overall_score
            })

            # Use upsert to handle potential duplicate call_ids
            response = self.client.table("eavesly_transcription_qa").upsert(
                data,
                on_conflict="call_id"
            ).execute()

            logger.info("Evaluation result stored successfully", extra={
                "correlation_id": correlation_id,
                "call_id": call_id,
                "rows_affected": len(response.data) if response.data else 0
            })

        except Exception as e:
            logger.error("Failed to store evaluation result", extra={
                "correlation_id": correlation_id,
                "call_id": call_id,
                "agent_id": agent_id,
                "error": str(e)
            }, exc_info=True)
            raise

    async def log_api_request(
        self,
        correlation_id: str,
        endpoint: str,
        status_code: int,
        processing_time_ms: int,
        error_message: Optional[str] = None,
        http_method: str = "POST"
    ) -> None:
        """
        Log API request metadata in api_logs table for audit trail.
        
        This method is designed to be non-blocking - if logging fails,
        it won't break the main API functionality.
        """
        try:
            data = {
                "correlation_id": correlation_id,
                "endpoint": endpoint,
                "http_method": http_method,
                "http_status_code": status_code,
                "processing_time_ms": processing_time_ms,
                "error_message": error_message,
                "request_timestamp": datetime.utcnow().isoformat()
            }

            logger.debug("Logging API request", extra={
                "correlation_id": correlation_id,
                "endpoint": endpoint,
                "status_code": status_code
            })

            # Insert API log entry
            self.client.table("api_logs").insert(data).execute()

            logger.debug("API request logged successfully", extra={
                "correlation_id": correlation_id,
                "endpoint": endpoint
            })

        except Exception as e:
            # Log the error but don't raise - API logging failures shouldn't break the main flow
            logger.warning("Failed to log API request", extra={
                "correlation_id": correlation_id,
                "endpoint": endpoint,
                "error": str(e)
            })

    @retry(
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=5),
        retry=retry_if_exception(Exception)
    )
    async def health_check(self) -> bool:
        """
        Check database connectivity and basic permissions.
        
        Returns True if database is accessible and basic operations work,
        False otherwise. Uses minimal query to verify connectivity.
        """
        try:
            logger.debug("Performing database health check")

            # Simple query to test connectivity - try to read from one of our tables
            response = self.client.table("eavesly_transcription_qa").select("call_id").limit(1).execute()

            # If we get here without exception, database is accessible
            is_healthy = True

            logger.debug("Database health check passed", extra={
                "query_success": True,
                "has_data": len(response.data) > 0 if response.data else False
            })

        except Exception as e:
            is_healthy = False
            logger.error("Database health check failed", extra={
                "error": str(e)
            })

        return is_healthy
