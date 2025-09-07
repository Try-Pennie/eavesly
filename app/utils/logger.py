"""
Structured logging system for the Call QA system.

Provides comprehensive logging with JSON formatting for production,
correlation ID support, and context management for request tracking.
"""

import logging
import sys
import json
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, Union
from contextlib import contextmanager
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
try:
    from pythonjsonlogger import jsonlogger
    HAS_JSON_LOGGER = True
except ImportError:
    # Fallback if pythonjsonlogger is not available
    jsonlogger = None
    HAS_JSON_LOGGER = False

# Context variables for correlation tracking
correlation_id_var: ContextVar[Optional[str]] = ContextVar('correlation_id', default=None)
request_id_var: ContextVar[Optional[str]] = ContextVar('request_id', default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar('user_id', default=None)

# Global logging configuration
_logging_configured = False


class ContextFilter(logging.Filter):
    """
    Logging filter that adds correlation ID and other context to log records.
    """
    
    def filter(self, record: logging.LogRecord) -> bool:
        """Add context variables to the log record"""
        # Add correlation ID if available
        record.correlation_id = correlation_id_var.get(None)
        record.request_id = request_id_var.get(None) 
        record.user_id = user_id_var.get(None)
        
        # Add timestamp in ISO format for consistency
        record.timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Add service information
        record.service = "pennie-call-qa"
        record.version = "1.0.0"
        
        return True


class ConsoleFormatter(logging.Formatter):
    """
    Human-readable console formatter for development.
    """
    
    def __init__(self):
        super().__init__()
        
        # Color codes for different log levels
        self.colors = {
            'DEBUG': '\033[36m',    # Cyan
            'INFO': '\033[32m',     # Green  
            'WARNING': '\033[33m',  # Yellow
            'ERROR': '\033[31m',    # Red
            'CRITICAL': '\033[35m', # Magenta
            'RESET': '\033[0m'      # Reset
        }
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record for console output"""
        # Color the log level
        level_color = self.colors.get(record.levelname, '')
        reset_color = self.colors['RESET']
        colored_level = f"{level_color}{record.levelname}{reset_color}"
        
        # Build the log message
        timestamp = datetime.fromtimestamp(record.created).strftime('%H:%M:%S.%f')[:-3]
        logger_name = record.name.split('.')[-1]  # Just the last part
        
        # Base message
        message = f"{timestamp} {colored_level:>8} [{logger_name}] {record.getMessage()}"
        
        # Add correlation ID if present
        correlation_id = getattr(record, 'correlation_id', None)
        if correlation_id:
            message += f" [corr_id={correlation_id[:8]}]"
        
        # Add exception info if present
        if record.exc_info:
            message += f"\n{self.formatException(record.exc_info)}"
        
        return message


if HAS_JSON_LOGGER:
    class JSONFormatter(jsonlogger.JsonFormatter):
        """
        Structured JSON formatter for production logging.
        """
        
        def __init__(self):
            super().__init__(
                fmt='%(timestamp)s %(levelname)s %(name)s %(funcName)s %(lineno)d %(message)s',
                datefmt='%Y-%m-%dT%H:%M:%S'
            )
        
        def process_log_record(self, log_record: Dict[str, Any]) -> Dict[str, Any]:
            """Process and enrich log record"""
            # Add context information
            log_record['service'] = 'pennie-call-qa'
            log_record['version'] = '1.0.0'
            
            # Ensure timestamp is properly formatted
            if 'timestamp' not in log_record:
                log_record['timestamp'] = datetime.utcnow().isoformat() + 'Z'
            
            return super().process_log_record(log_record)
else:
    class JSONFormatter(logging.Formatter):
        """
        Fallback JSON formatter when pythonjsonlogger is not available.
        """
        
        def __init__(self):
            super().__init__()
        
        def format(self, record: logging.LogRecord) -> str:
            """Format log record as JSON string"""
            log_obj = {
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'level': record.levelname,
                'logger': record.name,
                'message': record.getMessage(),
                'service': 'pennie-call-qa',
                'version': '1.0.0'
            }
            
            # Add context if available
            for attr in ['correlation_id', 'request_id', 'user_id']:
                value = getattr(record, attr, None)
                if value:
                    log_obj[attr] = value
            
            # Add exception info if present
            if record.exc_info:
                log_obj['exception'] = self.formatException(record.exc_info)
            
            return json.dumps(log_obj)


def configure_logging(
    log_level: str = "INFO",
    log_format: str = "console",
    enable_file_logging: bool = False,
    log_file_path: str = "logs/app.log",
    max_file_size: int = 10 * 1024 * 1024,  # 10MB
    backup_count: int = 5
) -> None:
    """
    Configure global logging settings.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_format: Format type ('console' or 'json')
        enable_file_logging: Whether to enable file logging
        log_file_path: Path to log file
        max_file_size: Maximum size of log file before rotation
        backup_count: Number of backup files to keep
    """
    global _logging_configured
    
    if _logging_configured:
        return
    
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    
    # Set formatter based on format type
    if log_format == "json":
        formatter = JSONFormatter()
    else:
        formatter = ConsoleFormatter()
    
    console_handler.setFormatter(formatter)
    console_handler.addFilter(ContextFilter())
    root_logger.addHandler(console_handler)
    
    # Add file handler if enabled
    if enable_file_logging:
        import os
        os.makedirs(os.path.dirname(log_file_path), exist_ok=True)
        
        file_handler = RotatingFileHandler(
            log_file_path,
            maxBytes=max_file_size,
            backupCount=backup_count
        )
        
        # Always use JSON format for file logs
        file_formatter = JSONFormatter()
        file_handler.setFormatter(file_formatter)
        file_handler.addFilter(ContextFilter())
        root_logger.addHandler(file_handler)
    
    # Prevent duplicate logging
    root_logger.propagate = False
    
    # Configure third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("supabase").setLevel(logging.INFO)
    
    _logging_configured = True


def get_logger(name: str) -> logging.Logger:
    """
    Get a configured logger instance.
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Configured logger instance with structured logging support
    """
    # Import settings here to avoid circular imports
    try:
        from app.config import settings
        
        if not _logging_configured:
            log_config = settings.get_log_config()
            configure_logging(
                log_level=log_config["level"],
                log_format=log_config["format"],
                enable_file_logging=not settings.is_development()
            )
    except ImportError:
        # Fallback configuration if settings not available
        if not _logging_configured:
            configure_logging()
    
    return logging.getLogger(name)


class StructuredLogger:
    """
    Enhanced structured logger with context support and convenience methods.
    """
    
    def __init__(self, name: str):
        self.logger = get_logger(name)
        self._context: Dict[str, Any] = {}
    
    def _log_with_context(
        self, 
        level: int, 
        message: str, 
        extra: Optional[Dict[str, Any]] = None,
        exc_info: bool = False
    ) -> None:
        """Internal method to log with context"""
        # Merge instance context with extra context
        merged_extra = {**self._context}
        if extra:
            merged_extra.update(extra)
        
        # Add correlation context if available
        correlation_id = correlation_id_var.get(None)
        request_id = request_id_var.get(None)
        if correlation_id:
            merged_extra['correlation_id'] = correlation_id
        if request_id:
            merged_extra['request_id'] = request_id
        
        self.logger.log(level, message, extra=merged_extra, exc_info=exc_info)
    
    def debug(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log debug message"""
        self._log_with_context(logging.DEBUG, message, extra)
    
    def info(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log info message"""
        self._log_with_context(logging.INFO, message, extra)
    
    def warning(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log warning message"""
        self._log_with_context(logging.WARNING, message, extra)
    
    def error(
        self, 
        message: str, 
        extra: Optional[Dict[str, Any]] = None,
        exc_info: bool = False
    ) -> None:
        """Log error message"""
        self._log_with_context(logging.ERROR, message, extra, exc_info)
    
    def critical(
        self, 
        message: str, 
        extra: Optional[Dict[str, Any]] = None,
        exc_info: bool = False
    ) -> None:
        """Log critical message"""
        self._log_with_context(logging.CRITICAL, message, extra, exc_info)
    
    def exception(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log exception with traceback"""
        self._log_with_context(logging.ERROR, message, extra, exc_info=True)
    
    def with_context(self, **context) -> 'StructuredLogger':
        """Return new logger instance with additional context"""
        new_logger = StructuredLogger(self.logger.name)
        new_logger._context = {**self._context, **context}
        return new_logger


@contextmanager
def correlation_context(correlation_id: Optional[str] = None):
    """
    Context manager for correlation ID tracking.
    
    Args:
        correlation_id: Optional correlation ID, generates one if not provided
    """
    if correlation_id is None:
        correlation_id = f"corr_{uuid.uuid4().hex[:12]}"
    
    token = correlation_id_var.set(correlation_id)
    try:
        yield correlation_id
    finally:
        correlation_id_var.reset(token)


@contextmanager
def request_context(
    request_id: Optional[str] = None,
    user_id: Optional[str] = None,
    correlation_id: Optional[str] = None
):
    """
    Context manager for request tracking.
    
    Args:
        request_id: Optional request ID
        user_id: Optional user ID  
        correlation_id: Optional correlation ID
    """
    if request_id is None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
    if correlation_id is None:
        correlation_id = f"corr_{uuid.uuid4().hex[:12]}"
    
    # Set context variables
    tokens = []
    tokens.append(request_id_var.set(request_id))
    tokens.append(correlation_id_var.set(correlation_id))
    if user_id:
        tokens.append(user_id_var.set(user_id))
    
    try:
        yield {
            'request_id': request_id,
            'correlation_id': correlation_id,
            'user_id': user_id
        }
    finally:
        # Reset all tokens
        for token in reversed(tokens):
            if hasattr(token, 'var'):  # Handle case where user_id token might not exist
                token.var.reset(token)


class TimedLogger:
    """
    Logger decorator/context manager for timing operations.
    """
    
    def __init__(self, logger: Union[logging.Logger, StructuredLogger], operation: str):
        self.logger = logger
        self.operation = operation
        self.start_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        if isinstance(self.logger, StructuredLogger):
            self.logger.debug(f"Starting {self.operation}")
        else:
            self.logger.debug(f"Starting {self.operation}")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = int((time.time() - self.start_time) * 1000)
        
        extra_context = {"operation": self.operation, "duration_ms": duration_ms}
        
        if exc_type is None:
            if isinstance(self.logger, StructuredLogger):
                self.logger.info(f"Completed {self.operation}", extra=extra_context)
            else:
                self.logger.info(f"Completed {self.operation} in {duration_ms}ms")
        else:
            extra_context["error"] = str(exc_val)
            if isinstance(self.logger, StructuredLogger):
                self.logger.error(f"Failed {self.operation}", extra=extra_context)
            else:
                self.logger.error(f"Failed {self.operation} after {duration_ms}ms: {exc_val}")


# Convenience function for backward compatibility
def get_structured_logger(name: str) -> StructuredLogger:
    """Get a structured logger instance"""
    return StructuredLogger(name)