# ─────────────────────────────────────────────────────────────────────────────
# MonCash BI Portal — Backend (FastAPI + Databricks SQL + Azure Identity)
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System dependencies:
# - tesseract-ocr + fra language pack (ID Card scanner in Business Tools)
# - libgomp1        (pandas / numpy runtime dep)
# - build-essential (only if a wheel isn't available for a dep — kept minimal)
# - curl            (healthcheck)
# - ca-certificates (Azure token acquisition)
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-fra \
        libgomp1 \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first so pip layer caches when only code changes
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the rest of the backend source
COPY . .

# Create a non-root user for runtime
RUN useradd --create-home --shell /bin/bash appuser \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Health check hits the OpenAPI docs endpoint (available whether or not auth is on)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/docs || exit 1

# 2 workers is a safe default for a small VM; override with UVICORN_WORKERS env
ENV UVICORN_WORKERS=2
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS} --proxy-headers --forwarded-allow-ips=*"]
