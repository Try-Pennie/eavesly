"""
Configuration management for the Call QA system.

Uses Pydantic Settings for environment variable management with comprehensive
validation and environment-specific configurations.
"""

from pydantic_settings import BaseSettings
from pydantic import Field, field_validator, HttpUrl, ConfigDict
from typing import Optional, Literal
from enum import Enum
import logging


class Environment(str, Enum):
    """Application environment types"""
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class LogLevel(str, Enum):
    """Logging level options"""
    DEBUG = "debug"
    INFO = "info" 
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    All required fields must be provided, optional fields have sensible defaults.
    Settings are validated on startup to catch configuration errors early.
    """
    
    # === REQUIRED API KEYS ===
    openrouter_api_key: str = Field(
        ...,
        description="OpenRouter API key for LLM access",
        min_length=1
    )
    promptlayer_api_key: str = Field(
        ..., 
        description="PromptLayer API key for prompt management",
        min_length=1
    )
    internal_api_key: str = Field(
        ...,
        description="Internal API key for authentication", 
        min_length=8
    )
    
    # === REQUIRED SUPABASE CONFIGURATION ===
    supabase_url: HttpUrl = Field(
        ...,
        description="Supabase project URL"
    )
    supabase_anon_key: str = Field(
        ...,
        description="Supabase anonymous/public key",
        min_length=1
    )
    supabase_service_role_key: str = Field(
        ...,
        description="Supabase service role key for admin access",
        min_length=1
    )
    
    # === APPLICATION CONFIGURATION ===
    environment: Environment = Field(
        default=Environment.DEVELOPMENT,
        description="Application environment (development/staging/production)"
    )
    port: int = Field(
        default=3000,
        ge=1024,
        le=65535,
        description="Port for the FastAPI application"
    )
    log_level: LogLevel = Field(
        default=LogLevel.INFO,
        description="Logging level for the application"
    )
    debug: bool = Field(
        default=False,
        description="Enable debug mode (auto-set based on environment)"
    )
    
    # === MODEL CONFIGURATION ===
    openrouter_model: str = Field(
        default="openai/gpt-4o-2024-08-06",
        description="Default OpenRouter model to use for evaluations"
    )
    max_retries: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Maximum number of retry attempts for LLM calls"
    )
    timeout_seconds: int = Field(
        default=30,
        ge=5,
        le=300,
        description="Timeout for LLM API calls in seconds"
    )
    
    # === OPTIONAL PERFORMANCE CONFIGURATION ===
    max_concurrent_evaluations: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Maximum number of concurrent evaluation tasks"
    )
    cache_ttl_seconds: int = Field(
        default=300,
        ge=60,
        le=3600,
        description="Cache TTL for prompt templates in seconds"
    )
    
    # === MONITORING & HEALTH CHECK CONFIGURATION ===
    health_check_timeout: int = Field(
        default=5,
        ge=1,
        le=30,
        description="Health check timeout in seconds"
    )
    enable_metrics: bool = Field(
        default=True,
        description="Enable metrics collection and exposure"
    )
    
    @field_validator('debug')
    @classmethod
    def set_debug_mode(cls, v, info):
        """Auto-set debug mode based on environment"""
        # Access other fields through context if needed
        if hasattr(info, 'data') and 'environment' in info.data:
            env = info.data.get('environment')
            if env == Environment.DEVELOPMENT:
                return True
        return v
    
    @field_validator('openrouter_api_key', 'promptlayer_api_key', 'internal_api_key')
    @classmethod
    def validate_api_keys(cls, v, info):
        """Validate API key format and security"""
        if not v or v.isspace():
            raise ValueError(f"{info.field_name} cannot be empty")
        
        if info.field_name == 'internal_api_key':
            if len(v) < 8:
                raise ValueError("internal_api_key must be at least 8 characters")
            if v == 'your_secure_internal_api_key_here':
                raise ValueError("internal_api_key cannot be the default placeholder")
        
        return v
    
    @field_validator('supabase_url')
    @classmethod
    def validate_supabase_url(cls, v):
        """Validate Supabase URL format"""
        url_str = str(v)
        if not url_str.endswith('.supabase.co') and not url_str.endswith('.supabase.io'):
            if 'localhost' not in url_str and '127.0.0.1' not in url_str:
                logging.warning(f"Supabase URL may be invalid: {url_str}")
        return v
    
    def is_development(self) -> bool:
        """Check if running in development mode"""
        return self.environment == Environment.DEVELOPMENT
    
    def is_production(self) -> bool:
        """Check if running in production mode"""
        return self.environment == Environment.PRODUCTION
    
    def is_staging(self) -> bool:
        """Check if running in staging mode"""
        return self.environment == Environment.STAGING
    
    def get_log_config(self) -> dict:
        """Get logging configuration based on environment"""
        # Handle both enum and string values for log_level
        level_value = self.log_level
        if hasattr(level_value, 'value'):
            level_str = level_value.value.upper()
        else:
            level_str = str(level_value).upper()
            
        return {
            "level": level_str,
            "format": "json" if self.is_production() else "console",
            "enable_correlation_ids": True,
            "enable_request_logging": True
        }
    
    model_config = ConfigDict(
        env_file=".env",
        case_sensitive=False,
        use_enum_values=True,
        validate_assignment=True,
        env_prefix=""
    )


_settings_instance: Optional[Settings] = None


def get_settings() -> Settings:
    """
    Get application settings instance.
    
    Settings are validated on first access and cached for subsequent calls.
    """
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = Settings()
    return _settings_instance


# Lazy-loaded global settings instance
class SettingsProxy:
    """Proxy that loads settings on first attribute access"""
    def __getattr__(self, name):
        return getattr(get_settings(), name)

settings = SettingsProxy()