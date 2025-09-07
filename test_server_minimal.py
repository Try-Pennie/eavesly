#!/usr/bin/env python3
"""
Minimal Test Server

A simplified version of the API for testing basic functionality
without requiring PromptLayer templates.
"""

import sys
import time
from datetime import datetime
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add app to path
sys.path.insert(0, '.')

from app.config import settings
from app.services.database import DatabaseService
from app.utils.logger import get_structured_logger

logger = get_structured_logger(__name__)

# Initialize database service only
db_service = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize minimal services on startup"""
    global db_service
    
    logger.info("Starting minimal test server", extra={
        "environment": settings.environment,
        "port": settings.port
    })
    
    # Initialize database service
    try:
        db_service = DatabaseService()
        logger.info("Database service initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
    
    yield
    
    logger.info("Shutting down minimal test server")

# Create FastAPI app
app = FastAPI(
    title="Minimal Call QA Test API",
    version="1.0.0-test",
    description="Minimal API for testing database integration",
    lifespan=lifespan,
    debug=settings.debug
)

@app.get("/health")
async def health_check():
    """Minimal health check endpoint"""
    try:
        # Check database connectivity
        database_healthy = False
        if db_service:
            try:
                database_healthy = await db_service.health_check()
            except Exception as db_error:
                logger.warning("Database health check failed", extra={"error": str(db_error)})
        
        health_status = {
            "status": "healthy" if database_healthy else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0.0-test",
            "environment": settings.environment,
            "dependencies": {
                "database": "healthy" if database_healthy else "unhealthy",
                "config": "loaded"
            }
        }
        
        status_code = 200 if database_healthy else 503
        return JSONResponse(content=health_status, status_code=status_code)
        
    except Exception as e:
        logger.error("Health check failed", exc_info=True)
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            }
        )

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Minimal Call QA Test API",
        "version": "1.0.0-test",
        "environment": settings.environment,
        "status": "Database testing only - no evaluation endpoints available",
        "endpoints": {
            "health": "/health"
        }
    }

@app.post("/test-db")
async def test_database():
    """Test database operations directly"""
    if not db_service:
        return JSONResponse(
            status_code=503,
            content={"error": "Database service not initialized"}
        )
    
    try:
        # Test health check
        health_ok = await db_service.health_check()
        
        if not health_ok:
            return JSONResponse(
                status_code=503,
                content={"error": "Database health check failed"}
            )
        
        # Test API logging
        correlation_id = f"test_{int(time.time())}"
        await db_service.log_api_request(
            correlation_id=correlation_id,
            endpoint="/test-db",
            status_code=200,
            processing_time_ms=100
        )
        
        return {
            "status": "success",
            "message": "Database operations completed successfully",
            "correlation_id": correlation_id,
            "timestamp": datetime.utcnow().isoformat(),
            "operations_performed": [
                "Health check",
                "API request logging"
            ]
        }
        
    except Exception as e:
        logger.error("Database test failed", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "error": "Database test failed",
                "message": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

if __name__ == "__main__":
    logger.info("Starting minimal test server", extra={
        "host": "0.0.0.0",
        "port": 3001,  # Use different port to avoid conflicts
    })
    
    uvicorn.run(
        "test_server_minimal:app",
        host="0.0.0.0",
        port=3001,
        reload=True,
        log_level="info"
    )