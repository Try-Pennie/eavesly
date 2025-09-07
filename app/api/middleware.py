"""
Middleware for authentication and request logging.

Provides API key authentication and request/response logging.
"""

import os
import time
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer
from fastapi.responses import JSONResponse
from typing import Optional

# Security scheme
security = HTTPBearer()


async def authenticate_api_key(authorization: Optional[str] = Depends(security)):
    """Authenticate requests using API key"""
    if not authorization:
        raise HTTPException(status_code=401, detail="API key required")
    
    expected_key = os.getenv("INTERNAL_API_KEY")
    if not expected_key:
        raise HTTPException(status_code=500, detail="API key not configured")
    
    if authorization.credentials != expected_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return True


async def log_request(request: Request, call_next):
    """Log all requests for monitoring and debugging"""
    start_time = time.time()
    
    # Log request details
    print(f"Request: {request.method} {request.url.path}")
    
    # Process request
    response = await call_next(request)
    
    # Calculate processing time
    processing_time = time.time() - start_time
    
    # Log response details
    print(f"Response: {response.status_code} in {processing_time:.3f}s")
    
    return response