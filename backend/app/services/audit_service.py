# backend/app/services/audit_service.py
"""
Centralized audit logging service.

Design rule: audit writes use their OWN engine connection, never the
request-scoped SQLAlchemy session.  This means:
  - an audit failure can never roll back the main entity
  - the main commit can never accidentally omit the audit row

Usage:
    from app.services.audit_service import AuditAction, log_action

    await log_action(
        db=db,
        action=AuditAction.USER_APPROVED,
        entity="users",
        entity_id=user.id,
        actor=current_user,
        request=request,
        description="Approved registration",
        old_values={"status": "PENDING_APPROVAL"},
        new_values={"status": "ACTIVE"},
    )

Never raises — failures are printed to stderr so the calling request is
never interrupted by an audit logging problem.
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("mohideen.audit")


# ─────────────────────────────────────────────────────────────
# TYPED ACTION CONSTANTS
# ─────────────────────────────────────────────────────────────

class AuditAction:
    # AUTH
    USER_REGISTERED       = "USER_REGISTERED"
    USER_LOGIN            = "USER_LOGIN"
    ADMIN_LOGIN           = "ADMIN_LOGIN"
    USER_LOGOUT           = "USER_LOGOUT"
    PASSWORD_CHANGED      = "PASSWORD_CHANGED"
    PASSWORD_RESET        = "PASSWORD_RESET"
    PROFILE_UPDATED       = "PROFILE_UPDATED"
    LOGIN_FAILED          = "LOGIN_FAILED"
    ACCOUNT_LOCKED        = "ACCOUNT_LOCKED"

    # USERS / REGISTRATION
    USER_APPROVED         = "USER_APPROVED"
    USER_REJECTED         = "USER_REJECTED"
    USER_DISABLED         = "USER_DISABLED"
    USER_ENABLED          = "USER_ENABLED"
    USER_ROLE_CHANGED     = "USER_ROLE_CHANGED"
    COLLECTOR_ASSIGNED    = "COLLECTOR_ASSIGNED"
    COLLECTOR_REMOVED     = "COLLECTOR_REMOVED"
    FAMILY_EDITED         = "FAMILY_EDITED"
    PHONE_UPDATED         = "PHONE_UPDATED"
    CHANDA_AMOUNT_UPDATED = "CHANDA_AMOUNT_UPDATED"
    FAMILY_DEACTIVATED    = "FAMILY_DEACTIVATED"
    FAMILY_RESTORED       = "FAMILY_RESTORED"
    FAMILY_ARCHIVED       = "FAMILY_ARCHIVED"
    USER_ACCOUNT_DELETED  = "USER_ACCOUNT_DELETED"

    # FINANCE
    DONATION_CREATED      = "DONATION_CREATED"
    DONATION_VERIFIED     = "DONATION_VERIFIED"
    DONATION_REJECTED     = "DONATION_REJECTED"
    DONATION_DELETED      = "DONATION_DELETED"
    EXPENSE_CREATED       = "EXPENSE_CREATED"
    EXPENSE_EDITED        = "EXPENSE_EDITED"
    EXPENSE_APPROVED      = "EXPENSE_APPROVED"
    EXPENSE_DELETED       = "EXPENSE_DELETED"
    RECEIPT_GENERATED     = "RECEIPT_GENERATED"

    # CHANDA
    PAYMENT_ADDED         = "PAYMENT_ADDED"
    PAYMENT_EDITED        = "PAYMENT_EDITED"
    PAYMENT_DELETED       = "PAYMENT_DELETED"
    PAYMENT_VERIFIED      = "PAYMENT_VERIFIED"
    PAYMENT_REJECTED      = "PAYMENT_REJECTED"
    PENDING_MONTH_GENERATED = "PENDING_MONTH_GENERATED"
    PENDING_MONTH_CLEARED = "PENDING_MONTH_CLEARED"
    BULK_IMPORT           = "BULK_IMPORT"
    COLLECTOR_COLLECTION_ADDED = "COLLECTOR_COLLECTION_ADDED"

    # PRAYER
    PRAYER_TIMES_UPDATED  = "PRAYER_TIMES_UPDATED"

    # ANNOUNCEMENTS
    ANNOUNCEMENT_CREATED  = "ANNOUNCEMENT_CREATED"
    ANNOUNCEMENT_EDITED   = "ANNOUNCEMENT_EDITED"
    ANNOUNCEMENT_DELETED  = "ANNOUNCEMENT_DELETED"
    ANNOUNCEMENT_PINNED   = "ANNOUNCEMENT_PINNED"
    ANNOUNCEMENT_UNPINNED = "ANNOUNCEMENT_UNPINNED"

    # HADITH
    HADITH_CREATED        = "HADITH_CREATED"
    HADITH_EDITED         = "HADITH_EDITED"
    HADITH_DELETED        = "HADITH_DELETED"

    # QUESTIONS
    QUESTION_ASKED        = "QUESTION_ASKED"
    QUESTION_ANSWERED     = "QUESTION_ANSWERED"
    QUESTION_DELETED      = "QUESTION_DELETED"

    # STAFF
    STAFF_CREATED         = "STAFF_CREATED"
    STAFF_EDITED          = "STAFF_EDITED"
    STAFF_REMOVED         = "STAFF_REMOVED"

    # SETTINGS
    SETTINGS_CHANGED      = "SETTINGS_CHANGED"

    # COLLECTOR CASH
    CASH_SUBMITTED        = "CASH_SUBMITTED"
    CASH_APPROVED         = "CASH_APPROVED"
    CASH_REJECTED         = "CASH_REJECTED"

    # IMPORT
    EXCEL_IMPORTED        = "EXCEL_IMPORTED"


_ACTION_MODULE: dict[str, str] = {
    "USER_REGISTERED": "Authentication", "USER_LOGIN": "Authentication",
    "ADMIN_LOGIN": "Authentication", "USER_LOGOUT": "Authentication",
    "PASSWORD_CHANGED": "Authentication", "PASSWORD_RESET": "Authentication",
    "PROFILE_UPDATED": "Authentication", "LOGIN_FAILED": "Authentication",
    "ACCOUNT_LOCKED": "Authentication",

    "USER_APPROVED": "Users", "USER_REJECTED": "Users", "USER_DISABLED": "Users",
    "USER_ENABLED": "Users", "USER_ROLE_CHANGED": "Users",
    "COLLECTOR_ASSIGNED": "Users", "COLLECTOR_REMOVED": "Users",
    "FAMILY_EDITED": "Users", "PHONE_UPDATED": "Users",
    "CHANDA_AMOUNT_UPDATED": "Users",
    "FAMILY_DEACTIVATED": "Users", "FAMILY_RESTORED": "Users",
    "FAMILY_ARCHIVED": "Users", "USER_ACCOUNT_DELETED": "Users",

    "DONATION_CREATED": "Donations", "DONATION_VERIFIED": "Donations",
    "DONATION_REJECTED": "Donations", "DONATION_DELETED": "Donations",
    "EXPENSE_CREATED": "Expenses", "EXPENSE_EDITED": "Expenses",
    "EXPENSE_APPROVED": "Expenses", "EXPENSE_DELETED": "Expenses",
    "RECEIPT_GENERATED": "Finance",

    "PAYMENT_ADDED": "Finance", "PAYMENT_EDITED": "Finance",
    "PAYMENT_DELETED": "Finance", "PAYMENT_VERIFIED": "Finance",
    "PAYMENT_REJECTED": "Finance", "PENDING_MONTH_GENERATED": "Finance",
    "PENDING_MONTH_CLEARED": "Finance", "BULK_IMPORT": "Finance",
    "COLLECTOR_COLLECTION_ADDED": "Finance",

    "PRAYER_TIMES_UPDATED": "Prayer",

    "ANNOUNCEMENT_CREATED": "Announcements", "ANNOUNCEMENT_EDITED": "Announcements",
    "ANNOUNCEMENT_DELETED": "Announcements", "ANNOUNCEMENT_PINNED": "Announcements",
    "ANNOUNCEMENT_UNPINNED": "Announcements",

    "HADITH_CREATED": "Hadith", "HADITH_EDITED": "Hadith", "HADITH_DELETED": "Hadith",

    "QUESTION_ASKED": "Questions", "QUESTION_ANSWERED": "Questions",
    "QUESTION_DELETED": "Questions",

    "STAFF_CREATED": "Users", "STAFF_EDITED": "Users", "STAFF_REMOVED": "Users",

    "SETTINGS_CHANGED": "System",

    "CASH_SUBMITTED": "Finance", "CASH_APPROVED": "Finance", "CASH_REJECTED": "Finance",

    "EXCEL_IMPORTED": "Finance",
}


def _extract_request_meta(request: Request | None) -> dict:
    if not request:
        return {}
    ip = getattr(request.state, "client_ip", None) or (
        request.client.host if request.client else None
    )
    ua = request.headers.get("user-agent", "")
    request_id = getattr(request.state, "request_id", None)
    return {
        "ip_address": ip,
        "user_agent": ua,
        "endpoint": str(request.url.path),
        "http_method": request.method,
        "request_id": str(request_id) if request_id else None,
    }


def _parse_browser_os(ua: str) -> tuple[str | None, str | None]:
    browser = os_name = None
    ua_lower = ua.lower()
    for name in ("edg", "chrome", "firefox", "safari", "opera"):
        if name in ua_lower:
            browser = name.capitalize()
            break
    for name in ("windows", "android", "iphone", "ipad", "mac", "linux"):
        if name in ua_lower:
            os_name = name.capitalize()
            break
    return browser, os_name


def _write_audit_row(params: dict) -> None:
    """
    Write one audit row using a dedicated engine connection (independent of
    the request-scoped SQLAlchemy session).  Called synchronously from
    log_action via asyncio.to_thread so it never blocks the event loop.
    """
    from app.database import engine
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO audit_logs (
                    table_name, record_id, action, action_label, module,
                    description, old_values, new_values,
                    performed_by_id, user_role, user_fullname,
                    ip_address, browser, os_name, device_name,
                    session_id, request_id, endpoint, http_method,
                    status, failure_reason, performed_at
                ) VALUES (
                    :table_name, :record_id, :action, :action_label, :module,
                    :description, CAST(:old_values AS jsonb), CAST(:new_values AS jsonb),
                    :performed_by_id, :user_role, :user_fullname,
                    :ip_address, :browser, :os_name, :device_name,
                    :session_id, :request_id, :endpoint, :http_method,
                    :status, :failure_reason, (NOW() AT TIME ZONE 'UTC')
                )
            """), params)
        print(
            f"[audit] OK action={params.get('action')}",
            file=sys.stderr, flush=True,
        )
    except Exception as exc:
        print(
            f"[audit] full INSERT failed for action={params.get('action')}: {exc}",
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
                        :performed_by_id, :ip_address, (NOW() AT TIME ZONE 'UTC')
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
                f"[audit] fallback INSERT also failed for action={params.get('action')}: {exc2}",
                file=sys.stderr, flush=True,
            )


async def log_action(
    db: Session,
    action: str,
    entity: str,
    entity_id: int | None = None,
    actor: dict | None = None,
    request: Request | None = None,
    description: str | None = None,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
    status: str = "success",
    failure_reason: str | None = None,
) -> None:
    """
    Write one audit log row asynchronously.
    Uses a dedicated DB connection — never touches the caller's session.
    Never raises.
    """
    import asyncio
    import json

    try:
        meta = _extract_request_meta(request)
        ua = meta.get("user_agent", "")
        browser, os_name = _parse_browser_os(ua)

        actor_id   = int(actor["sub"]) if actor and actor.get("sub") else None
        actor_role = actor.get("role") if actor else None
        actor_name = actor.get("name") if actor else None
        session_id_raw = actor.get("session_id") if actor else None
        session_id = int(session_id_raw) if session_id_raw is not None else None

        module = _ACTION_MODULE.get(action, "System")

        params = {
            "table_name":      entity,
            "record_id":       entity_id or 0,
            "action":          action,
            "action_label":    action.replace("_", " ").title(),
            "module":          module,
            "description":     description,
            "old_values":      json.dumps(old_values) if old_values is not None else None,
            "new_values":      json.dumps(new_values) if new_values is not None else None,
            "performed_by_id": actor_id,
            "user_role":       actor_role,
            "user_fullname":   actor_name,
            "ip_address":      meta.get("ip_address"),
            "browser":         browser,
            "os_name":         os_name,
            "device_name":     (ua[:200] if ua else None),
            "session_id":      session_id,
            "request_id":      meta.get("request_id"),
            "endpoint":        meta.get("endpoint"),
            "http_method":     meta.get("http_method"),
            "status":          status,
            "failure_reason":  failure_reason,
        }

        await asyncio.to_thread(_write_audit_row, params)

    except Exception as exc:
        print(
            f"[audit] log_action setup failed action={action} entity={entity}: {exc}",
            file=sys.stderr, flush=True,
        )
