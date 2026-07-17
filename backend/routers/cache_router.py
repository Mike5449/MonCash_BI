from typing import Optional

from fastapi import APIRouter, Query

from core.cache import cache

router = APIRouter(
    prefix="/cache",
    tags=["monitoring"],
)


@router.get("/stats", summary="Cache hit/miss statistics")
def cache_stats():
    """Return live cache metrics: entries, hits, misses, hit rate, cached methods."""
    return cache.stats()


@router.post("/clear", summary="Clear the result cache (optionally by method prefix)")
def cache_clear(
    prefix: Optional[str] = Query(
        None,
        description="If set, only drop keys for this method (e.g. 'CustomerService.get_customers'). Empty = clear all.",
    )
):
    """Invalidate cached results. Use after a fresh Databricks load to force refresh."""
    cleared = cache.clear(prefix)
    return {"status": "ok", "cleared_entries": cleared, "prefix": prefix}
