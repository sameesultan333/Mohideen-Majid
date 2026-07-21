"""
Redis-backed rate limiting for FastAPI endpoints.

Falls back silently when Redis is unavailable (no 429 raised, just logs a warning).
"""
import logging
from fastapi import HTTPException, Request

from app.redis_client import get_async_redis

logger = logging.getLogger(__name__)

# ── Pre-defined policy buckets ─────────────────────────────────────────────
POLICIES = {
    "login":           (5,   900),   # 5 login attempts / 15 min
    "register":        (3,   3600),  # 3 registrations / hour per IP
    "change_password": (5,   900),   # 5 attempts / 15 min
    "forgot_password": (3,   900),   # 3 resets / 15 min
    "otp_send":        (5,   300),   # 5 OTP sends / 5 min
    "otp_verify":      (10,  300),   # 10 OTP verify attempts / 5 min
    "question":        (10,  300),   # 10 questions / 5 min
    "answer":          (20,  300),   # 20 answers / 5 min
    "donation":        (5,   60),    # 5 payment submissions / min (member self-pay)
    "collector_write": (60,  60),    # 60 writes / min — collectors process many payments per session;
                                      # this is a DoS safety net, not a workflow throttle.
    "upload":          (20,  60),    # 20 uploads / min
    "announce":        (30,  60),    # 30 announcements / min
    "api_public":      (100, 60),    # 100 req/min (public)
    "api_admin":       (300, 60),    # 300 req/min (admin)
}


def _client_key(request: Request) -> str:
    """Best-effort client identifier: prefers X-Forwarded-For (behind Nginx), else remote IP."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit(
    request: Request,
    policy: str,
    *,
    key_suffix: str = "",
    max_requests: int = 0,
    window_seconds: int = 0,
) -> None:
    """
    Raises HTTP 429 if the caller exceeds the rate limit.

    Pass either a named `policy` (uses POLICIES dict) or explicit
    `max_requests` + `window_seconds`.
    """
    redis = get_async_redis()
    if redis is None:
        logger.warning("[rate_limit] Redis unavailable — skipping limit for %s", policy)
        return

    if max_requests == 0:
        if policy not in POLICIES:
            return
        max_requests, window_seconds = POLICIES[policy]

    client_ip = _client_key(request)
    cache_key = f"rl:{policy}:{client_ip}"
    if key_suffix:
        cache_key += f":{key_suffix}"

    try:
        pipe = redis.pipeline()
        await pipe.incr(cache_key)
        await pipe.expire(cache_key, window_seconds)
        results = await pipe.execute()
        count = results[0]

        if count > max_requests:
            retry_after = window_seconds
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Try again in {retry_after // 60 or 1} minute(s).",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[rate_limit] Redis error, skipping limit: %s", exc)


async def rate_limit_phone(request: Request, policy: str, phone: str) -> None:
    """Rate limit keyed on (IP + phone) — prevents phone enumeration attacks."""
    await rate_limit(request, policy, key_suffix=phone[-4:] if phone else "")


async def clear_rate_limit(policy: str, request: Request, key_suffix: str = "") -> None:
    """Clear a rate limit bucket on success (e.g. after OTP verified)."""
    redis = get_async_redis()
    if redis is None:
        return
    client_ip = _client_key(request)
    cache_key = f"rl:{policy}:{client_ip}"
    if key_suffix:
        cache_key += f":{key_suffix}"
    try:
        await redis.delete(cache_key)
    except Exception:
        pass
