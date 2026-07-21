"""
Redis cache helpers for read endpoints.

Usage:
    from app.cache import cache_get, cache_set, cache_invalidate

    async def get_prayer_times():
        cached = await cache_get("prayer:today")
        if cached:
            return cached
        data = fetch_from_db()
        await cache_set("prayer:today", data, ttl=300)
        return data

Never use caching for writes or financial mutations.
"""
import json
import logging
from typing import Any, Optional

from app.redis_client import get_async_redis

logger = logging.getLogger(__name__)

# ── Default TTLs (seconds) ────────────────────────────────────────────────────
TTL = {
    "prayer":        300,    # 5 min  — changes rarely
    "announcement":  60,     # 1 min  — near-real-time
    "hadith":        600,    # 10 min
    "questions":     120,    # 2 min
    "dashboard":     30,     # 30 sec — finance dashboard (never cache writes)
    "unread":        10,     # 10 sec — notification badges
    "default":       60,
}


async def cache_get(key: str) -> Optional[Any]:
    redis = get_async_redis()
    if not redis:
        return None
    try:
        raw = await redis.get(f"cache:{key}")
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("[cache] get failed for %s: %s", key, exc)
        return None


async def cache_set(key: str, value: Any, *, ttl: int = TTL["default"]) -> None:
    redis = get_async_redis()
    if not redis:
        return
    try:
        await redis.setex(f"cache:{key}", ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("[cache] set failed for %s: %s", key, exc)


async def cache_invalidate(*keys: str) -> None:
    """Delete one or more cache keys."""
    redis = get_async_redis()
    if not redis:
        return
    try:
        await redis.delete(*[f"cache:{k}" for k in keys])
    except Exception as exc:
        logger.warning("[cache] invalidate failed: %s", exc)


async def cache_invalidate_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern (e.g. 'prayer:*')."""
    redis = get_async_redis()
    if not redis:
        return
    try:
        keys = await redis.keys(f"cache:{pattern}")
        if keys:
            await redis.delete(*keys)
    except Exception as exc:
        logger.warning("[cache] pattern invalidate failed for %s: %s", pattern, exc)
