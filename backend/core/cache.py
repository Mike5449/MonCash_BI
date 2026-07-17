"""
Result cache for read-only Databricks analytics.

Databricks SQL queries are slow (warehouse latency + heavy aggregations) but the
source data only changes ~once per day (most tables snapshot on
`DATE_CODE = CURRENT_DATE - 1`). Caching identical query results for a few minutes
removes almost all repeated warehouse round-trips.

Two interchangeable backends, selected by `settings.CACHE_BACKEND`:

* ``memory`` — process-local TTL dict. Zero infra, but each instance keeps its
  own cache and state is lost on restart. Fine for a single instance.
* ``redis``  — shared cache for **multi-instance** deployments. All API instances
  read/write the same keys, so a value cached by one instance serves every
  instance, the hit rate scales with the fleet, and `/cache/clear` is global.
  If Redis is unreachable at startup, the app logs a warning and falls back to
  the memory backend so it still runs.

Both backends expose the same surface used by the decorator and admin router:
``get`` / ``set`` / ``clear`` / ``stats`` / ``lock``.

Design notes
------------
* Single-flight (anti-dogpile) — when N identical requests arrive for a key that
  is not yet cached, only the first computes it; the others wait and reuse the
  result. ``memory`` uses a per-key thread lock; ``redis`` uses a best-effort
  distributed lock so the dedup holds *across* instances too.
* Memory guard — large result sets (e.g. 2M-row exports) are never cached, so
  memory / Redis stays bounded even though export endpoints share service
  methods with the lightweight UI list endpoints.
* Serialization (redis) — values are pickled, preserving exact Python types
  (dates, Decimal, floats) so a cache hit is byte-identical to a fresh compute.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import pickle
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Sentinel returned by *.get on a miss (None is a legitimate cached value).
_MISS = object()

# Default knobs — overridable per-decorator or via core.config settings.
DEFAULT_TTL = 600           # 10 minutes
DEFAULT_MAX_SIZE = 1024     # max distinct cached keys (memory backend)
DEFAULT_MAX_ITEMS = 50_000  # don't cache result rows beyond this (memory guard)

# Redis key namespaces.
_NS_DATA = "appcache:data:"
_NS_LOCK = "appcache:lock:"
_NS_HITS = "appcache:stats:hits"
_NS_MISSES = "appcache:stats:misses"


# ---------------------------------------------------------------------------
# Memory backend
# ---------------------------------------------------------------------------
class MemoryCache:
    """Process-local thread-safe cache mapping key -> (expiry_epoch, value)."""

    backend = "memory"

    def __init__(self, default_ttl: int = DEFAULT_TTL, max_size: int = DEFAULT_MAX_SIZE):
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.RLock()
        self.default_ttl = default_ttl
        self.max_size = max_size
        self.hits = 0
        self.misses = 0
        # Per-key locks for single-flight.
        self._inflight_guard = threading.Lock()
        self._inflight: dict[str, threading.Lock] = {}

    def get(self, key: str) -> Any:
        with self._lock:
            item = self._store.get(key)
            if item is None:
                self.misses += 1
                return _MISS
            expiry, value = item
            if time.time() >= expiry:
                self._store.pop(key, None)
                self.misses += 1
                return _MISS
            self.hits += 1
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        with self._lock:
            if len(self._store) >= self.max_size:
                self._evict_locked()
            self._store[key] = (time.time() + (ttl or self.default_ttl), value)

    def _evict_locked(self) -> None:
        """Drop expired entries first; if still full, drop the soonest-to-expire."""
        now = time.time()
        for k in [k for k, (exp, _) in self._store.items() if exp <= now]:
            self._store.pop(k, None)
        if len(self._store) >= self.max_size:
            victims = sorted(self._store.items(), key=lambda kv: kv[1][0])
            for k, _ in victims[: max(1, self.max_size // 10)]:
                self._store.pop(k, None)

    def clear(self, prefix: Optional[str] = None) -> int:
        with self._lock:
            if prefix is None:
                n = len(self._store)
                self._store.clear()
                return n
            keys = [k for k in self._store if k.startswith(prefix)]
            for k in keys:
                self._store.pop(k, None)
            return len(keys)

    @contextmanager
    def lock(self, key: str):
        with self._inflight_guard:
            lk = self._inflight.get(key)
            if lk is None:
                lk = threading.Lock()
                if len(self._inflight) > DEFAULT_MAX_SIZE * 2:
                    self._inflight.clear()
                self._inflight[key] = lk
        with lk:
            yield

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total = self.hits + self.misses
            return {
                "backend": self.backend,
                "entries": len(self._store),
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / total, 3) if total else 0.0,
                "max_size": self.max_size,
                "default_ttl_seconds": self.default_ttl,
                "keys": sorted({k.split("|", 1)[0] for k in self._store}),
            }


# Backward-compatible alias (older imports referenced TTLCache).
TTLCache = MemoryCache


# ---------------------------------------------------------------------------
# Redis backend (shared, multi-instance)
# ---------------------------------------------------------------------------
class RedisCache:
    """Shared cache backed by Redis. Values are pickled for exact type fidelity."""

    backend = "redis"

    def __init__(self, client: Any, default_ttl: int = DEFAULT_TTL):
        self._client = client
        self.default_ttl = default_ttl

    def get(self, key: str) -> Any:
        try:
            raw = self._client.get(_NS_DATA + key)
        except Exception as e:  # Redis hiccup → behave as a miss, never crash the request
            logger.warning("[CACHE] redis GET failed: %s", e)
            return _MISS
        if raw is None:
            self._incr(_NS_MISSES)
            return _MISS
        try:
            value = pickle.loads(raw)
        except Exception as e:
            logger.warning("[CACHE] redis unpickle failed for %s: %s", key, e)
            return _MISS
        self._incr(_NS_HITS)
        return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        try:
            raw = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)
            self._client.set(_NS_DATA + key, raw, ex=(ttl or self.default_ttl))
        except Exception as e:
            logger.warning("[CACHE] redis SET failed for %s: %s", key, e)

    def _incr(self, name: str) -> None:
        try:
            self._client.incr(name)
        except Exception:
            pass

    def clear(self, prefix: Optional[str] = None) -> int:
        match = _NS_DATA + (prefix + "*" if prefix else "*")
        deleted = 0
        try:
            keys = list(self._client.scan_iter(match=match, count=500))
            if keys:
                deleted = self._client.delete(*keys)
        except Exception as e:
            logger.warning("[CACHE] redis clear failed: %s", e)
        return int(deleted or 0)

    @contextmanager
    def lock(self, key: str):
        """Best-effort distributed single-flight lock.

        Auto-expires (so a crashed holder can't deadlock the fleet) and gives up
        waiting after a bounded time, proceeding to compute rather than failing.
        """
        rlock = None
        acquired = False
        try:
            rlock = self._client.lock(
                _NS_LOCK + key,
                timeout=30,           # lock auto-expiry
                blocking_timeout=10,  # wait at most 10s, then proceed anyway
            )
            acquired = rlock.acquire()
        except Exception as e:
            logger.debug("[CACHE] redis lock acquire failed for %s: %s", key, e)
        try:
            yield
        finally:
            if rlock is not None and acquired:
                try:
                    rlock.release()
                except Exception:
                    pass

    def stats(self) -> dict[str, Any]:
        entries = 0
        methods: set[str] = set()
        hits = misses = 0
        try:
            for raw_key in self._client.scan_iter(match=_NS_DATA + "*", count=500):
                entries += 1
                k = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
                k = k[len(_NS_DATA):]
                methods.add(k.split("|", 1)[0])
            hits = int(self._client.get(_NS_HITS) or 0)
            misses = int(self._client.get(_NS_MISSES) or 0)
        except Exception as e:
            logger.warning("[CACHE] redis stats failed: %s", e)
        total = hits + misses
        return {
            "backend": self.backend,
            "entries": entries,
            "hits": hits,
            "misses": misses,
            "hit_rate": round(hits / total, 3) if total else 0.0,
            "default_ttl_seconds": self.default_ttl,
            "keys": sorted(methods),
        }


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------
def _build_cache():
    """Pick the cache backend from settings, falling back to memory on error."""
    try:
        from core.config import settings
    except Exception:
        return MemoryCache()

    ttl = getattr(settings, "CACHE_DEFAULT_TTL", DEFAULT_TTL)
    backend = (getattr(settings, "CACHE_BACKEND", "memory") or "memory").lower()

    if backend == "redis":
        url = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")
        try:
            import redis  # redis-py
            client = redis.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=5)
            client.ping()
            logger.info("[CACHE] Using shared Redis backend at %s (ttl=%ss)", url, ttl)
            return RedisCache(client, default_ttl=ttl)
        except Exception as e:
            logger.warning(
                "[CACHE] CACHE_BACKEND=redis but Redis is unavailable (%s). "
                "Falling back to per-process memory cache.", e
            )
            return MemoryCache(default_ttl=ttl)

    return MemoryCache(default_ttl=ttl)


# Module-level singleton used by the decorator and the admin router.
cache = _build_cache()


# ---------------------------------------------------------------------------
# Key building, memory guard, decorator
# ---------------------------------------------------------------------------
def _make_key(func: Callable, args: tuple, kwargs: dict) -> str:
    """Build a stable cache key, ignoring any SQLAlchemy Session argument."""
    norm_args = [a for a in args if not isinstance(a, Session)]
    norm_kwargs = {k: v for k, v in kwargs.items() if not isinstance(v, Session)}
    payload = {"a": norm_args, "k": norm_kwargs}
    try:
        raw = json.dumps(payload, default=str, sort_keys=True)
    except TypeError:
        raw = repr(payload)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return f"{func.__qualname__}|{digest}"


def _result_too_big(result: Any, max_items: int) -> bool:
    """True when a result is too large to cache safely (memory guard)."""
    if isinstance(result, list):
        return len(result) > max_items
    if isinstance(result, dict):
        rows = result.get("rows")
        if isinstance(rows, list):
            return len(rows) > max_items
    return False


def cached(ttl: Optional[int] = None, max_items: int = DEFAULT_MAX_ITEMS) -> Callable:
    """Decorator: cache a read-only function's result for `ttl` seconds.

    The wrapped function MUST be a pure read (no side effects), since identical
    arguments return a cached value. The `db` Session argument is excluded from
    the cache key, so the same query reuses one entry across requests/instances.
    """

    def deco(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                from core.config import settings
                if not getattr(settings, "CACHE_ENABLED", True):
                    return func(*args, **kwargs)
            except Exception:
                pass  # settings unavailable → cache stays on

            key = _make_key(func, args, kwargs)
            value = cache.get(key)
            if value is not _MISS:
                return value

            # Single-flight: only one worker computes a missing key at a time
            # (per-process for memory, fleet-wide for redis).
            with cache.lock(key):
                value = cache.get(key)  # double-check after acquiring the lock
                if value is not _MISS:
                    return value
                result = func(*args, **kwargs)
                if _result_too_big(result, max_items):
                    logger.debug("[CACHE] skip (too big) %s", func.__qualname__)
                else:
                    cache.set(key, result, ttl)
                return result

        wrapper.__cache_wrapped__ = func  # type: ignore[attr-defined]
        return wrapper

    return deco


def cache_all_methods(
    cls: type,
    ttl: Optional[int] = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    exclude: tuple[str, ...] = (),
) -> type:
    """Wrap every @staticmethod of a service class with `cached`.

    Use only on classes whose static methods are all read-only queries.
    """
    for name, attr in list(vars(cls).items()):
        if name.startswith("_") or name in exclude:
            continue
        if isinstance(attr, staticmethod):
            wrapped = cached(ttl=ttl, max_items=max_items)(attr.__func__)
            setattr(cls, name, staticmethod(wrapped))
    return cls
