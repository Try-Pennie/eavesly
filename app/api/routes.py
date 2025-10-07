"""
API routes for the Call QA system.

Defines the main evaluation endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
import time
import uuid
import asyncio
from datetime import datetime

from app.models.requests import EvaluateCallRequest
from app.models.responses import EvaluateCallResponse, EvaluationSummary, SkippedCallResponse
from app.api.middleware import authenticate_api_key
from app.utils.logger import get_structured_logger, request_context

# Initialize logger
logger = get_structured_logger(__name__)

# Router instance
router = APIRouter()


def get_orchestrator():
    """Dependency to get orchestrator instance"""
    from app.main import orchestrator
    return orchestrator


def get_db_service():
    """Dependency to get database service instance"""
    from app.main import db_service
    return db_service


@router.post("/evaluate-call", dependencies=[Depends(authenticate_api_key)])
async def evaluate_call(
    request: EvaluateCallRequest,
    orchestrator=Depends(get_orchestrator),
    db_service=Depends(get_db_service)
):
    """Main endpoint for call evaluation"""
    correlation_id = f"eval_{uuid.uuid4().hex}"
    start_time = time.time()
    
    try:
        logger.info("Starting evaluation for call", extra={
            "call_id": request.call_id,
            "correlation_id": correlation_id,
            "agent_id": request.agent_id,
            "call_context": request.call_context.value if request.call_context else "unknown"
        })

        # Check if talk_time is below minimum threshold
        if request.transcript.metadata.talk_time is not None and request.transcript.metadata.talk_time < 60:
            processing_time_ms = int((time.time() - start_time) * 1000)

            logger.info("Call skipped - talk_time below threshold", extra={
                "call_id": request.call_id,
                "correlation_id": correlation_id,
                "talk_time": request.transcript.metadata.talk_time,
                "threshold": 60,
                "processing_time_ms": processing_time_ms
            })

            return SkippedCallResponse(
                call_id=request.call_id,
                correlation_id=correlation_id,
                timestamp=datetime.utcnow(),
                processing_time_ms=processing_time_ms,
                status="skipped",
                reason="talk_time_too_short",
                details={
                    "talk_time": request.transcript.metadata.talk_time,
                    "minimum_required": 60,
                    "message": f"Call was not evaluated because talk_time ({request.transcript.metadata.talk_time}s) is below minimum threshold of 60 seconds"
                }
            )

        # Perform evaluation using orchestrator
        evaluation_result = await orchestrator.evaluate_call(request)
        
        # Calculate overall score and generate summary
        overall_score = orchestrator.calculate_overall_score(evaluation_result)
        summary_data = orchestrator.generate_summary(evaluation_result)
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Store results in database (placeholder for now)
        try:
            await db_service.store_evaluation_result(
                correlation_id=correlation_id,
                call_id=request.call_id,
                agent_id=request.agent_id,
                evaluation_result=evaluation_result.dict(),
                overall_score=overall_score,
                processing_time_ms=processing_time_ms
            )
        except Exception as db_error:
            logger.warning("Failed to store evaluation result", extra={
                "correlation_id": correlation_id,
                "call_id": request.call_id,
                "error": str(db_error)
            })
        
        logger.info("Evaluation completed for call", extra={
            "call_id": request.call_id,
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
            summary=EvaluationSummary(**summary_data)
        )
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        logger.error("Evaluation failed for call", extra={
            "call_id": request.call_id,
            "correlation_id": correlation_id,
            "error": str(e),
            "processing_time_ms": processing_time_ms
        }, exc_info=True)
        
        # Return structured error response
        raise HTTPException(
            status_code=500,
            detail={
                "error": "EVALUATION_FAILED",
                "message": "Internal server error during evaluation",
                "correlation_id": correlation_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )


@router.post("/evaluate-batch", dependencies=[Depends(authenticate_api_key)])
async def evaluate_batch(
    calls: List[EvaluateCallRequest],
    orchestrator=Depends(get_orchestrator),
    db_service=Depends(get_db_service)
):
    """Batch evaluation endpoint for processing multiple calls concurrently"""
    batch_start_time = time.time()
    batch_correlation_id = f"batch_{uuid.uuid4().hex}"
    
    logger.info("Starting batch evaluation", extra={
        "batch_correlation_id": batch_correlation_id,
        "call_count": len(calls),
        "call_ids": [call.call_id for call in calls]
    })
    
    if not calls:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "EMPTY_BATCH",
                "message": "Batch request cannot be empty",
                "correlation_id": batch_correlation_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    # Check if batch size is within limits (from config)
    from app.config import settings
    if len(calls) > settings.max_concurrent_evaluations:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "BATCH_SIZE_EXCEEDED",
                "message": f"Batch size {len(calls)} exceeds maximum allowed {settings.max_concurrent_evaluations}",
                "correlation_id": batch_correlation_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    async def evaluate_single_call(call_request: EvaluateCallRequest):
        """Evaluate a single call within the batch"""
        call_correlation_id = f"eval_{uuid.uuid4().hex}"
        call_start_time = time.time()
        
        try:
            logger.debug("Starting evaluation for call in batch", extra={
                "call_id": call_request.call_id,
                "correlation_id": call_correlation_id,
                "batch_correlation_id": batch_correlation_id
            })

            # Check if talk_time is below minimum threshold
            if call_request.transcript.metadata.talk_time is not None and call_request.transcript.metadata.talk_time < 60:
                processing_time_ms = int((time.time() - call_start_time) * 1000)

                logger.info("Call skipped in batch - talk_time below threshold", extra={
                    "call_id": call_request.call_id,
                    "correlation_id": call_correlation_id,
                    "batch_correlation_id": batch_correlation_id,
                    "talk_time": call_request.transcript.metadata.talk_time,
                    "threshold": 60
                })

                return {
                    "call_id": call_request.call_id,
                    "success": True,
                    "skipped": True,
                    "response": SkippedCallResponse(
                        call_id=call_request.call_id,
                        correlation_id=call_correlation_id,
                        timestamp=datetime.utcnow(),
                        processing_time_ms=processing_time_ms,
                        status="skipped",
                        reason="talk_time_too_short",
                        details={
                            "talk_time": call_request.transcript.metadata.talk_time,
                            "minimum_required": 60,
                            "message": f"Call was not evaluated because talk_time ({call_request.transcript.metadata.talk_time}s) is below minimum threshold of 60 seconds"
                        }
                    )
                }

            # Perform evaluation using orchestrator
            evaluation_result = await orchestrator.evaluate_call(call_request)
            
            # Calculate overall score and generate summary
            overall_score = orchestrator.calculate_overall_score(evaluation_result)
            summary_data = orchestrator.generate_summary(evaluation_result)
            
            processing_time_ms = int((time.time() - call_start_time) * 1000)
            
            # Store results in database (placeholder for now)
            try:
                await db_service.store_evaluation_result(
                    correlation_id=call_correlation_id,
                    call_id=call_request.call_id,
                    agent_id=call_request.agent_id,
                    evaluation_result=evaluation_result.dict(),
                    overall_score=overall_score,
                    processing_time_ms=processing_time_ms
                )
            except Exception as db_error:
                logger.warning("Failed to store batch evaluation result", extra={
                    "correlation_id": call_correlation_id,
                    "call_id": call_request.call_id,
                    "batch_correlation_id": batch_correlation_id,
                    "error": str(db_error)
                })
            
            return {
                "call_id": call_request.call_id,
                "success": True,
                "response": EvaluateCallResponse(
                    call_id=call_request.call_id,
                    correlation_id=call_correlation_id,
                    timestamp=datetime.utcnow(),
                    processing_time_ms=processing_time_ms,
                    evaluation=evaluation_result,
                    overall_score=overall_score,
                    summary=EvaluationSummary(**summary_data)
                )
            }
            
        except Exception as e:
            processing_time_ms = int((time.time() - call_start_time) * 1000)
            
            logger.error("Batch call evaluation failed", extra={
                "call_id": call_request.call_id,
                "correlation_id": call_correlation_id,
                "batch_correlation_id": batch_correlation_id,
                "error": str(e),
                "processing_time_ms": processing_time_ms
            }, exc_info=True)
            
            return {
                "call_id": call_request.call_id,
                "success": False,
                "error": {
                    "error": "EVALUATION_FAILED",
                    "message": str(e),
                    "correlation_id": call_correlation_id,
                    "timestamp": datetime.utcnow().isoformat()
                }
            }
    
    try:
        # Process all calls concurrently
        results = await asyncio.gather(
            *[evaluate_single_call(call) for call in calls],
            return_exceptions=True
        )
        
        # Process results and handle any exceptions from gather
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append({
                    "call_id": calls[i].call_id,
                    "success": False,
                    "error": {
                        "error": "EVALUATION_FAILED",
                        "message": str(result),
                        "correlation_id": f"eval_{uuid.uuid4().hex}",
                        "timestamp": datetime.utcnow().isoformat()
                    }
                })
            else:
                processed_results.append(result)
        
        # Calculate batch statistics
        total_processing_time_ms = int((time.time() - batch_start_time) * 1000)
        successful_count = sum(1 for r in processed_results if r["success"])
        failed_count = len(processed_results) - successful_count
        
        logger.info("Batch evaluation completed", extra={
            "batch_correlation_id": batch_correlation_id,
            "total": len(calls),
            "successful": successful_count,
            "failed": failed_count,
            "total_processing_time_ms": total_processing_time_ms
        })
        
        return {
            "batch_correlation_id": batch_correlation_id,
            "timestamp": datetime.utcnow().isoformat(),
            "total_processing_time_ms": total_processing_time_ms,
            "results": processed_results,
            "summary": {
                "total": len(calls),
                "successful": successful_count,
                "failed": failed_count,
                "success_rate": successful_count / len(calls) if calls else 0.0
            }
        }
        
    except Exception as e:
        total_processing_time_ms = int((time.time() - batch_start_time) * 1000)
        
        logger.error("Batch evaluation failed", extra={
            "batch_correlation_id": batch_correlation_id,
            "error": str(e),
            "total_processing_time_ms": total_processing_time_ms
        }, exc_info=True)
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "BATCH_EVALUATION_FAILED",
                "message": "Internal server error during batch evaluation",
                "correlation_id": batch_correlation_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )