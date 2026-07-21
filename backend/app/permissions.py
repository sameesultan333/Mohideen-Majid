# backend/app/permissions.py
"""
Permission matrix — maps roles to allowed actions.
Use require_permission("can_delete_expense") instead of require_admin()
when you need fine-grained control beyond the four roles.
"""

from fastapi import HTTPException, status
from fastapi.security import HTTPBearer
from app.security import get_current_user
from fastapi import Depends

# ─────────────────────────────────────────────────────────────
# MATRIX
# Each key is a permission name.
# Value is the set of roles that have that permission.
# ─────────────────────────────────────────────────────────────
PERMISSION_MATRIX: dict[str, set[str]] = {
    # ── Finance ──────────────────────────────────────────────
    "view_finance":           {"admin", "superadmin", "collector"},
    "collect_payment":        {"admin", "superadmin", "collector"},
    "verify_payment":         {"admin", "superadmin"},
    "create_expense":         {"admin", "superadmin"},
    "edit_expense":           {"admin", "superadmin"},
    "delete_expense":         {"superadmin"},
    "approve_expense":        {"admin", "superadmin"},
    "create_donation":        {"admin", "superadmin", "collector"},
    "delete_donation":        {"superadmin"},
    "view_ledger":            {"admin", "superadmin"},
    "view_audit":             {"admin", "superadmin"},
    "export_reports":         {"admin", "superadmin"},
    "manage_purposes":        {"admin", "superadmin"},
    "manage_settings":        {"superadmin"},

    # ── Chanda ───────────────────────────────────────────────
    "generate_chanda_month":  {"admin", "superadmin"},
    "view_defaulters":        {"admin", "superadmin", "collector"},

    # ── Family / Members ─────────────────────────────────────
    "view_families":          {"admin", "superadmin", "collector"},
    "create_family":          {"admin", "superadmin"},
    "edit_family":            {"admin", "superadmin"},
    "activate_family":        {"admin", "superadmin"},
    "import_families":        {"superadmin"},

    # ── Staff ────────────────────────────────────────────────
    "manage_staff":           {"superadmin"},
    "view_staff":             {"admin", "superadmin"},

    # ── Religious Content ────────────────────────────────────
    "manage_prayer":          {"admin", "superadmin", "imam"},
    "manage_announcements":   {"admin", "superadmin", "imam"},
    "manage_hadith":          {"admin", "superadmin", "imam"},
    "answer_questions":       {"admin", "superadmin", "imam"},
    "view_questions":         {"admin", "superadmin", "imam"},

    # ── Upload ───────────────────────────────────────────────
    "upload_media":           {"admin", "superadmin", "imam", "collector"},

    # ── SMS ──────────────────────────────────────────────────
    "send_sms":               {"admin", "superadmin"},
    "view_sms_queue":         {"admin", "superadmin"},
}


def require_permission(permission: str):
    """
    FastAPI dependency factory.
    Usage:  current_user = Depends(require_permission("delete_expense"))
    """
    def _check(current_user: dict = Depends(get_current_user)) -> dict:
        role = current_user.get("role", "")
        allowed = PERMISSION_MATRIX.get(permission, set())
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission}' requires role in {sorted(allowed)}",
            )
        return current_user
    return _check


def has_permission(role: str, permission: str) -> bool:
    """Non-dependency helper for inline checks."""
    return role in PERMISSION_MATRIX.get(permission, set())
