"""
Central Redis client — import `redis_client` everywhere.

Falls back gracefully when Redis is unavailable so the app still starts
(rate limiting and caching degrade, but auth/DB paths still work).
"""
import os
import logging
from typing import Optional

import redis.asyncio as aioredis
import redis as sync_redis

logger = logging.getLogger(__name__)

_REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# ── Async client (for FastAPI endpoints) ─────────────────────────────────────
_async_pool: Optional[aioredis.Redis] = None

def get_async_redis() -> Optional[aioredis.Redis]:
    return _async_pool

async def init_redis() -> bool:
    global _async_pool
    try:
        _async_pool = aioredis.from_url(
            _REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        await _async_pool.ping()
        logger.info("[redis] connected to %s", _REDIS_URL.split("@")[-1])
        return True
    except Exception as exc:
        logger.warning("[redis] unavailable — running without cache/rate-limit: %s", exc)
        _async_pool = None
        return False

async def close_redis():
    global _async_pool
    if _async_pool:
        await _async_pool.aclose()
        _async_pool = None

# ── Sync client (for APScheduler background jobs) ────────────────────────────
_sync_client: Optional[sync_redis.Redis] = None

def get_sync_redis() -> Optional[sync_redis.Redis]:
    global _sync_client
    if _sync_client is None:
        try:
            _sync_client = sync_redis.from_url(
                _REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=3,
            )
            _sync_client.ping()
        except Exception as exc:
            logger.warning("[redis-sync] unavailable: %s", exc)
            _sync_client = None
    return _sync_client
