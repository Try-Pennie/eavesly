"""
Pennie Call QA System - Main FastAPI Application

This is the main entry point for the Call QA evaluation system.
Enhanced with structured logging and configuration management.
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import uuid
from datetime import datetime

from app.config import settings
from app.utils.logger import get_structured_logger, request_context, TimedLogger

# Initialize structured logger
logger = get_structured_logger(__name__)

# API and service imports
from app.api.routes import router
from app.services.orchestrator import CallQAOrchestrator
from app.services.database import DatabaseService

# Global service instances
orchestrator = CallQAOrchestrator()
db_service = DatabaseService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup"""
    logger.info("Starting Call QA API", extra={
        "environment": settings.environment,
        "port": settings.port,
        "log_level": settings.log_level,
        "debug": settings.debug
    })
    
    # Initialize orchestrator
    await orchestrator.initialize()
    
    yield
    
    logger.info("Shutting down Call QA API")
    # Cleanup services
    await orchestrator.prompt_client.close()


app = FastAPI(
    title="Pennie Call QA API",
    version="1.0.0", 
    description="AI-enabled call quality assessment system with structured logging",
    lifespan=lifespan,
    debug=settings.debug
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_development() else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(router, prefix="/api/v1", tags=["evaluation"])


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Request logging middleware with correlation ID tracking"""
    start_time = time.time()
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    
    # Use request context for correlation tracking
    with request_context(request_id=request_id) as context:
        logger.info("Request started", extra={
            "method": request.method,
            "path": request.url.path,
            "query_params": str(request.query_params),
            "client_ip": request.client.host if request.client else "unknown"
        })
        
        try:
            response = await call_next(request)
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            logger.info("Request completed", extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "processing_time_ms": processing_time_ms
            })
            
            # Add correlation ID to response headers
            response.headers["X-Correlation-ID"] = context["correlation_id"]
            response.headers["X-Request-ID"] = context["request_id"]
            
            return response
            
        except Exception as e:
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            logger.error("Request failed", extra={
                "method": request.method,
                "path": request.url.path,
                "error": str(e),
                "processing_time_ms": processing_time_ms
            }, exc_info=True)
            
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Internal server error",
                    "correlation_id": context["correlation_id"],
                    "timestamp": datetime.utcnow().isoformat()
                }
            )


@app.get("/health")
async def health_check():
    """Enhanced health check endpoint for monitoring"""
    try:
        with TimedLogger(logger, "health check"):
            # Check database connectivity
            database_healthy = False
            try:
                database_healthy = await db_service.health_check()
            except Exception as db_error:
                logger.warning("Database health check failed", extra={"error": str(db_error)})
            
            # Check orchestrator initialization
            orchestrator_healthy = orchestrator.initialized if hasattr(orchestrator, 'initialized') else False
            
            # Determine overall status
            overall_healthy = database_healthy and orchestrator_healthy
            
            health_status = {
                "status": "healthy" if overall_healthy else "degraded",
                "timestamp": datetime.utcnow().isoformat(),
                "version": "1.0.0",
                "environment": settings.environment,
                "config": {
                    "debug_mode": settings.debug,
                    "log_level": settings.log_level,
                    "max_retries": settings.max_retries,
                    "timeout_seconds": settings.timeout_seconds
                },
                "dependencies": {
                    "config": "loaded",
                    "logging": "configured",
                    "database": "healthy" if database_healthy else "unhealthy",
                    "orchestrator": "healthy" if orchestrator_healthy else "unhealthy"
                    # Note: We don't actively check OpenRouter/PromptLayer here to avoid quota usage
                }
            }
            
            logger.debug("Health check completed", extra={
                "overall_status": health_status["status"],
                "database_healthy": database_healthy,
                "orchestrator_healthy": orchestrator_healthy
            })
            
            # Return 503 if not fully healthy
            if not overall_healthy:
                return JSONResponse(
                    status_code=503,
                    content=health_status
                )
            
            return health_status
            
    except Exception as e:
        logger.error("Health check failed", exc_info=True)
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "error": "Health check failed",
                "message": str(e)
            }
        )


@app.get("/")
async def root():
    """Root endpoint with enhanced information"""
    return {
        "message": "Pennie Call QA API",
        "version": "1.0.0",
        "environment": settings.environment,
        "endpoints": {
            "docs": "/docs",
            "health": "/health",
            "openapi": "/openapi.json"
        },
        "features": [
            "Structured logging with correlation IDs",
            "Environment-based configuration",
            "Request/response tracking",
            "Health monitoring"
        ]
    }


@app.get("/config")
async def get_config():
    """Get non-sensitive configuration information (development only)"""
    if not settings.is_development():
        raise HTTPException(status_code=404, detail="Not found")
    
    # Only return non-sensitive configuration
    return {
        "environment": settings.environment,
        "debug": settings.debug,
        "log_level": settings.log_level,
        "port": settings.port,
        "model": settings.openrouter_model,
        "max_retries": settings.max_retries,
        "timeout_seconds": settings.timeout_seconds,
        "max_concurrent_evaluations": settings.max_concurrent_evaluations
    }


if __name__ == "__main__":
    import uvicorn
    
    logger.info("Starting application server", extra={
        "host": "0.0.0.0",
        "port": settings.port,
        "reload": settings.is_development()
    })
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0", 
        port=settings.port,
        reload=settings.is_development(),
        log_level=settings.log_level.lower() if hasattr(settings.log_level, 'lower') else str(settings.log_level).lower()
    )