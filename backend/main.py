import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

import models.user   # noqa: F401 — register models for create_all
import models.rbac   # noqa: F401 — register RBAC models for create_all
from core.config import settings
from core.exceptions import BaseAPIException, api_exception_handler
from core.middleware import SecurityHeadersMiddleware
from database import Base, SessionLocal, engine
from routers.auth_router import router as auth_router
from routers.user_router import router as user_router
from routers.analytics_router import router as analytics_router
from routers.customer_router import router as customer_router
from routers.biller_router import router as biller_router
from routers.merchant_router import router as merchant_router
from routers.prefunded_router import router as prefunded_router
from routers.imt_router import router as imt_router
from routers.period_report_router import router as period_report_router
from routers.id_card_router import router as id_card_router
from routers.operations_router import router as operations_router
from routers.cache_router import router as cache_router

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# RBAC auto-seed helper
# ---------------------------------------------------------------------------
def _seed_rbac_if_needed() -> None:
    """Populate roles/permissions tables on first startup (idempotent)."""
    from scripts.seed_rbac import seed as _seed_rbac

    db = SessionLocal()
    try:
        _seed_rbac(db)
    except Exception:
        logger.exception("RBAC seed failed — permissions will fall back to built-in defaults")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Lifespan — runs once at startup and once at shutdown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - Disabled table creation for read-only analytics access
    # Base.metadata.create_all(bind=engine)
    # _seed_rbac_if_needed()
    yield
    # Shutdown (nothing to clean up)


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

# ---------------------------------------------------------------------------
# OpenAPI tag metadata (controls order and descriptions in Swagger UI)
# ---------------------------------------------------------------------------
TAGS_METADATA = [
    {
        "name": "auth",
        "description": "Authentication endpoints.",
    },
    {
        "name": "users",
        "description": "User management.",
    },
    {
        "name": "customers",
        "description": "Customer registration audits and transaction history.",
    },
    {
        "name": "billers",
        "description": "Utility partner audits and collection logs.",
    },
    {
        "name": "merchants",
        "description": "mCom business partner audits and payment logs.",
    },
    {
        "name": "prefunded",
        "description": "Prefunded partner audits and settlement logs.",
    },
    {
        "name": "analytics",
        "description": "Global analytics, bulk processing, and administrative data tasks.",
    },
]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    lifespan=lifespan,
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description=(
        "## Secure base system API\n\n"
        "Domain-driven architecture for MonCash BI auditing."
    ),
    openapi_tags=TAGS_METADATA,
    swagger_ui_parameters={
        "persistAuthorization": True,
        "displayRequestDuration": True,
        "filter": True,
        "syntaxHighlight.theme": "monokai",
    },
    license_info={
        "name": "Private — All Rights Reserved",
    },
)

# Attach rate-limiter state so SlowAPIMiddleware can find it
app.state.limiter = limiter

# ---------------------------------------------------------------------------
# Middleware — order matters: first added = outermost
# ---------------------------------------------------------------------------

# 1. Trusted hosts (Host header allow-list, comma-separated in .env ALLOWED_HOSTS)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_hosts_list,
)

# 2. CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)

# 3. Security headers on every response
app.add_middleware(SecurityHeadersMiddleware)

# 4. Rate limiting
app.add_middleware(SlowAPIMiddleware)

# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------
app.add_exception_handler(BaseAPIException, api_exception_handler)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again later."},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(user_router)
app.include_router(auth_router)
app.include_router(analytics_router)
app.include_router(customer_router)
app.include_router(biller_router)
app.include_router(merchant_router)
app.include_router(prefunded_router)
app.include_router(imt_router)
app.include_router(period_report_router)
app.include_router(id_card_router)
app.include_router(operations_router)
app.include_router(cache_router)


# ---------------------------------------------------------------------------
# Core endpoints
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME}"}


@app.get("/health", tags=["monitoring"], summary="Health check")
def health_check():
    """Returns `ok` when the service is running and reachable."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Customise the OpenAPI schema
# ---------------------------------------------------------------------------
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=TAGS_METADATA,
    )

    schema.setdefault("components", {}).setdefault("securitySchemes", {})
    schema["components"]["securitySchemes"]["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Paste your access token here (without the 'Bearer' prefix).",
    }

    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if isinstance(operation, dict):
                if "token" not in str(operation.get("operationId", "")):
                    operation.setdefault("security", [{"BearerAuth": []}])

    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi
