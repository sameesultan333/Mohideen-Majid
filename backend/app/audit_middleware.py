# app/audit_middleware.py
# Centralized audit middleware — automatically logs every API mutation.
# Route-level log_action() calls still work for before/after diffs;
# this middleware captures everything else with zero manual effort.
#
# Design rule: ALL DB writes run in asyncio.to_thread() so they never
# block the event loop on Windows (ProactorEventLoop + psycopg2).

from __future__ import annotations

import asyncio
import sys
import time
import uuid

from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.database import engine


# ─── skip lists ──────────────────────────────────────────────
_SKIP_PREFIXES = (
    "/uploads/",
    "/ws/",
    "/docs",
    "/redoc",
    "/openapi",
    "/audit",          # never audit the audit viewer
    "/auth/refresh",   # silent token rotation
    "/auth/me",
    "/auth/sessions",
)

# Only log GETs for these high-value endpoints
_AUDIT_GET_PATHS = {
    "/finance/dashboard",
    "/funds/dashboard",
}

# ─── mapping helpers ─────────────────────────────────────────

def _module(path: str) -> str:
    p = path.lower()
    if "/auth"         in p: return "Authentication"
    if "/prayer"       in p: return "Prayer"
    if "/announcement" in p: return "Announcements"
    if "/hadith"       in p: return "Hadith"
    if "/question"     in p: return "Questions"
    if "/donation"     in p: return "Donations"
    if "/expense"      in p: return "Expenses"
    if "/fund"         in p: return "Funds"
    if "/chanda"       in p: return "Finance"
    if "/payment"      in p: return "Finance"
    if "/finance"      in p: return "Finance"
    if "/staff"        in p: return "Users"
    if "/user"         in p: return "Users"
    if "/admin"        in p: return "Families"
    if "/device"       in p: return "Notifications"
    return "System"


def _table(path: str) -> str:
    p = path.lower()
    if "/prayer"       in p: return "prayer_timings"
    if "/donation"     in p: return "donations"
    if "/expense"      in p: return "expenses"
    if "/fund"         in p: return "funds"
    if "/announcement" in p: return "announcements"
    if "/hadith"       in p: return "hadiths"
    if "/question"     in p: return "questions"
    if "/chanda"       in p: return "chanda_collections"
    if "/payment"      in p: return "payment_entries"
    if "/staff"        in p: return "users"
    if "/user"         in p: return "users"
    if "/admin"        in p: return "approved_heads"
    if "/auth"         in p: return "user_sessions"
    if "/device"       in p: return "device_tokens"
    return "system"


def _record_id(path: str) -> int:
    for part in reversed(path.rstrip("/").split("/")):
        if part.isdigit():
            return int(part)
    return 0


def _action_label(method: str, path: str, status_code: int) -> str:
    m = method.upper()
    p = path.lower()

    if "login"               in p: return "Login Success"  if status_code < 400 else "Login Failed"
    if "logout-all"          in p: return "All Sessions Revoked"
    if "logout"              in p: return "Logout"
    if "register"            in p: return "User Registered"
    if "change-password"     in p: return "Password Changed"

    if "/fund" in p:
        if "archive"   in p: return "Fund Archived"
        if "unarchive" in p: return "Fund Unarchived"
        if "close"     in p: return "Fund Closed"
        if "restore"   in p: return "Fund Restored"
        if m == "POST": return "Fund Created"
        if m in ("PUT", "PATCH"): return "Fund Updated"
        if m == "DELETE": return "Fund Deleted"
        if m == "GET": return "Fund Viewed"

    if "/prayer" in p:
        if m in ("PUT", "PATCH", "POST"): return "Prayer Times Updated"

    if "/announcement" in p:
        if "pin"       in p: return "Announcement Pinned"
        if "unpin"     in p: return "Announcement Unpinned"
        if m == "POST"  : return "Announcement Created"
        if m in ("PUT","PATCH"): return "Announcement Updated"
        if m == "DELETE": return "Announcement Deleted"

    if "/hadith" in p:
        if "approve" in p: return "Hadith Approved"
        if "reject"  in p: return "Hadith Rejected"
        if m == "POST"  : return "Hadith Created"
        if m in ("PUT","PATCH"): return "Hadith Updated"
        if m == "DELETE": return "Hadith Deleted"

    if "/question" in p:
        if "answer" in p or "/answers" in p: return "Question Answered"
        if "reply"  in p or "/replies" in p: return "Reply Added"
        if m == "DELETE": return "Question Deleted"

    if "/donation" in p:
        if "approve"  in p: return "Donation Approved"
        if "reject"   in p: return "Donation Rejected"
        if "verify"   in p: return "Donation Verified"
        if m == "POST"  : return "Donation Submitted"
        if m in ("PUT","PATCH"): return "Donation Edited"
        if m == "DELETE": return "Donation Deleted"

    if "/expense" in p:
        if "approve"  in p: return "Expense Approved"
        if "reject"   in p: return "Expense Rejected"
        if "/categor" in p and m == "POST": return "Expense Category Created"
        if m == "POST"  : return "Expense Created"
        if m in ("PUT","PATCH"): return "Expense Updated"
        if m == "DELETE": return "Expense Deleted"

    if "/chanda" in p or "/payment" in p:
        if "verify"  in p: return "Payment Verified"
        if "reject"  in p: return "Payment Rejected"
        if "approve" in p: return "Payment Approved"
        if m == "POST"  : return "Payment Added"
        if m in ("PUT","PATCH"): return "Payment Edited"
        if m == "DELETE": return "Payment Deleted"

    if "/staff" in p or "/user" in p or "/admin" in p:
        if "activate"   in p: return "User Activated"
        if "deactivate" in p: return "User Deactivated"
        if "password"   in p: return "Password Changed"
        if "role"       in p: return "Role Changed"
        if m == "POST"  : return "User Created"
        if m in ("PUT","PATCH"): return "User Updated"
        if m == "DELETE": return "User Deleted"

    if "/finance/settings" in p: return "Finance Settings Changed"

    verbs = {"POST": "Created", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted", "GET": "Viewed"}
    return verbs.get(m, m.capitalize())


def _browser(ua: str) -> str:
    u = ua.lower()
    if "edg/"     in u: return "Edge"
    if "chrome/"  in u: return "Chrome"
    if "firefox/" in u: return "Firefox"
    if "safari/"  in u: return "Safari"
    if "mobile"   in u: return "Mobile"
    return "Unknown"


def _os(ua: str) -> str:
    u = ua.lower()
    if "android" in u: return "Android"
    if "iphone"  in u or "ipad" in u: return "iOS"
    if "windows" in u: return "Windows"
    if "mac os"  in u: return "macOS"
    if "linux"   in u: return "Linux"
    return "Unknown"


# ─── sync worker (runs in thread pool) ───────────────────────

def _do_audit_insert(params: dict, method: str, path: str) -> None:
    """
    Perform the audit INSERT in a thread so it never blocks the event loop.
    Tries the full INSERT first, falls back to base columns on failure.
    Any error is printed to stderr — never raised to the caller.
    """
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO audit_logs (
                    table_name, record_id, action, action_label, module, description,
                    performed_by_id, user_role, user_fullname, ip_address,
                    browser, os_name, session_id, request_id, endpoint,
                    http_method, status, failure_reason, execution_time_ms,
                    performed_at
                ) VALUES (
                    :table_name, :record_id, :action, :action_label, :module, :description,
                    :performed_by_id, :user_role, :user_fullname, :ip_address,
                    :browser, :os_name, :session_id, :request_id, :endpoint,
                    :http_method, :status, :failure_reason, :execution_time_ms,
                    NOW()
                )
            """), params)
        print(
            f"[audit-mw] OK ({method} {path})",
            file=sys.stderr, flush=True,
        )
    except Exception as exc:
        print(
            f"[audit-mw] full INSERT failed ({method} {path}): {exc}",
            file=sys.stderr, flush=True,
        )
        try:
            with engine.begin() as conn:
                conn.execute(text("""
                    INSERT INTO audit_logs (
                        table_name, record_id, action,
                        performed_by_id, ip_address, performed_at
                    ) VALUES (
                        :table_name, :record_id, :action,
                        :performed_by_id, :ip_address, NOW()
                    )
                """), {
                    "table_name":      params["table_name"],
                    "record_id":       params["record_id"],
                    "action":          params["action"],
                    "performed_by_id": params.get("performed_by_id"),
                    "ip_address":      params.get("ip_address"),
                })
        except Exception as exc2:
            print(
                f"[audit-mw] fallback INSERT also failed ({method} {path}): {exc2}",
                file=sys.stderr, flush=True,
            )


def _lookup_user_name(user_id: int) -> str | None:
    """Look up user name from DB in a thread."""
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT name FROM users WHERE id = :uid"), {"uid": user_id}
            ).fetchone()
            return row[0] if row else None
    except Exception:
        return None


# ─── middleware ──────────────────────────────────────────────

class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path   = request.url.path
        method = request.method.upper()

        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await call_next(request)

        is_mutation = method in ("POST", "PUT", "PATCH", "DELETE")
        is_audit_get = method == "GET" and path in _AUDIT_GET_PATHS
        if not is_mutation and not is_audit_get:
            return await call_next(request)

        start    = time.time()
        response = await call_next(request)
        elapsed  = int((time.time() - start) * 1000)

        sc = response.status_code
        if sc >= 500:
            req_status = "critical"
        elif sc >= 400:
            req_status = "failed"
        else:
            req_status = "success"

        # Extract user from JWT (best-effort, runs in thread)
        user_id   = None
        user_role = None
        user_name = None
        session_id = None

        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            try:
                from app.security import decode_token
                payload    = decode_token(auth[7:])
                user_id    = int(payload.get("sub", 0)) or None
                user_role  = payload.get("role")
                session_id_raw = payload.get("session_id")
                session_id = int(session_id_raw) if session_id_raw is not None else None
                if user_id:
                    user_name = await asyncio.to_thread(_lookup_user_name, user_id)
            except Exception:
                pass

        ip  = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else None)
        )
        ua    = request.headers.get("user-agent", "")
        label = _action_label(method, path, sc)
        desc  = f"{label} — {method} {path}"

        params = {
            "table_name":        _table(path),
            "record_id":         _record_id(path) or 0,
            "action":            f"{method}:{path}",
            "action_label":      label,
            "module":            _module(path),
            "description":       desc,
            "performed_by_id":   user_id,
            "user_role":         user_role,
            "user_fullname":     user_name,
            "ip_address":        ip,
            "browser":           _browser(ua),
            "os_name":           _os(ua),
            "session_id":        session_id,
            "request_id":        uuid.uuid4().hex[:12],
            "endpoint":          path,
            "http_method":       method,
            "status":            req_status,
            "failure_reason":    f"HTTP {sc}" if sc >= 400 else None,
            "execution_time_ms": elapsed,
        }

        # Fire-and-forget in thread pool — never blocks response delivery
        asyncio.get_running_loop().run_in_executor(
            None, _do_audit_insert, params, method, path
        )

        return response
