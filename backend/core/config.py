from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PROJECT_NAME: str = "App Base System"

    # Databricks
    DATABRICKS_SERVER_HOSTNAME: str
    DATABRICKS_HTTP_PATH: str
    ANALYTICS_INPUT_PATH: str

    # JWT — no defaults, must be set in .env
    SECRET_KEY: str
    REFRESH_SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS — comma-separated origins in .env
    CORS_ORIGINS: str = "http://localhost:3000"

    # TrustedHostMiddleware — comma-separated hostnames (Host header allow-list).
    # Empty string means accept any host (matches nginx catch-all). Set to a
    # specific comma-separated list in production to reject spoofed Host headers.
    ALLOWED_HOSTS: str = ""

    # Reverse proxy path prefix. When the API is served behind nginx at /api/*
    # (as in the Docker Compose stack), set ROOT_PATH=/api so FastAPI generates
    # Swagger UI + OpenAPI URLs with that prefix. Empty when running directly.
    ROOT_PATH: str = ""

    # Brute-force protection
    MAX_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 15

    # Result cache (read-only Databricks analytics)
    CACHE_ENABLED: bool = True
    CACHE_DEFAULT_TTL: int = 3600  # seconds (10 min)
    # "memory" = per-process; "redis" = shared across instances (multi-instance)
    CACHE_BACKEND: str = "memory"
    REDIS_URL: str = "redis://localhost:6379/0"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> List[str]:
        hosts = [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]
        return hosts if hosts else ["*"]

    class Config:
        case_sensitive = True
        env_file = ".env"
        extra = "ignore"


settings = Settings()
