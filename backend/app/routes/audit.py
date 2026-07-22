# backend/app/routes/audit.py
# Immutable enterprise audit log — Super Admin only, no write endpoints.

from __future__ import annotations

import io
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import require_superadmin, require_admin
from app.utils.timezones import to_india, utc_now

from sqlalchemy import text as _sql_text

router = APIRouter(prefix="/audit", tags=["Audit"])

FORBIDDEN_MSG = "Only Administrator or Super Administrator can access Audit Logs."


# ─────────────────────────────────────────────────────────────
# GET /audit/debug  — raw row count (superadmin only)
# ─────────────────────────────────────────────────────────────

@router.get("/debug")
def audit_debug(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Returns raw audit_logs row count so you can confirm entries are being written."""
    try:
        row = db.execute(_sql_text("SELECT COUNT(*) FROM audit_logs")).fetchone()
        total = row[0] if row else 0
        latest = db.execute(_sql_text(
            "SELECT id, action, module, status, performed_at FROM audit_logs ORDER BY id DESC LIMIT 5"
        )).fetchall()
        return {
            "total_rows": total,
            "latest_5": [
                {"id": r[0], "action": r[1], "module": r[2], "status": r[3], "performed_at": str(r[4])}
                for r in latest
            ],
        }
    except Exception as exc:
        return {"error": str(exc)}


def _403():
    raise HTTPException(status_code=403, detail=FORBIDDEN_MSG)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _serialize(a: models.AuditLog) -> dict:
    return {
        "id":                   a.id,
        "table_name":           a.table_name,
        "record_id":            a.record_id,
        "action":               a.action,
        "action_label":         a.action_label or a.action,
        "module":               a.module or _infer_module(a.table_name),
        "description":          a.description or a.note,
        "old_values":           a.old_values,
        "new_values":           a.new_values,
        "performed_by_id":      a.performed_by_id,
        "performed_by":         a.performed_by.name if a.performed_by else None,
        "user_fullname":        a.user_fullname or (a.performed_by.name if a.performed_by else None),
        "user_role":            a.user_role or (a.performed_by.role if a.performed_by else None),
        "performed_at":         a.performed_at.isoformat() + "Z" if a.performed_at else None,
        "ip_address":           a.ip_address,
        "browser":              a.browser,
        "os_name":              a.os_name,
        "device_name":          a.device_name,
        "session_id":           a.session_id,
        "request_id":           a.request_id,
        "endpoint":             a.endpoint,
        "http_method":          a.http_method,
        "status":               a.status or "success",
        "failure_reason":       a.failure_reason,
        "execution_time_ms":    a.execution_time_ms,
        "affected_record_type": a.affected_record_type,
        "note":                 a.note,
    }


_TABLE_MODULE_MAP = {
    "users":            "Users",
    "approved_heads":   "Families",
    "prayer_timings":   "Prayer",
    "announcements":    "Announcements",
    "hadiths":          "Hadith",
    "questions":        "Questions",
    "answers":          "Questions",
    "replies":          "Questions",
    "chanda_collections": "Finance",
    "payment_entries":  "Finance",
    "donations":        "Donations",
    "expenses":         "Expenses",
    "expense_categories": "Expenses",
    "funds":            "Funds",
    "receipts":         "Finance",
    "finance_transactions": "Finance",
    "finance_settings": "System",
    "device_tokens":    "Notifications",
    "sms_queue":        "Notifications",
    "user_sessions":    "Authentication",
    "audit_logs":       "System",
}


def _infer_module(table_name: str) -> str:
    return _TABLE_MODULE_MAP.get(table_name, "System")


def _build_query(
    db: Session,
    search: Optional[str],
    module: Optional[str],
    role: Optional[str],
    status: Optional[str],
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    action: Optional[str],
    performed_by_id: Optional[int],
):
    q = db.query(models.AuditLog)

    if search:
        like = f"%{search}%"
        q = q.outerjoin(models.User, models.AuditLog.performed_by_id == models.User.id).filter(
            or_(
                models.AuditLog.action.ilike(like),
                models.AuditLog.action_label.ilike(like),
                models.AuditLog.description.ilike(like),
                models.AuditLog.table_name.ilike(like),
                models.AuditLog.module.ilike(like),
                models.AuditLog.ip_address.ilike(like),
                models.AuditLog.browser.ilike(like),
                models.AuditLog.device_name.ilike(like),
                models.AuditLog.user_fullname.ilike(like),
                models.AuditLog.user_role.ilike(like),
                models.AuditLog.note.ilike(like),
                models.AuditLog.request_id.ilike(like),
                models.User.name.ilike(like),
                models.User.phone.ilike(like),
            )
        )
    else:
        q = q.outerjoin(models.User, models.AuditLog.performed_by_id == models.User.id)

    if module:
        # match on explicit module column OR infer from table_name for old records
        matching_tables = [k for k, v in _TABLE_MODULE_MAP.items() if v == module]
        q = q.filter(
            or_(
                models.AuditLog.module == module,
                and_(
                    models.AuditLog.module.is_(None),
                    models.AuditLog.table_name.in_(matching_tables),
                ),
            )
        )
    if role:
        q = q.filter(
            or_(
                models.AuditLog.user_role == role,
                models.User.role == role,
            )
        )
    if status:
        q = q.filter(models.AuditLog.status == status)
    if action:
        q = q.filter(models.AuditLog.action == action)
    if performed_by_id:
        q = q.filter(models.AuditLog.performed_by_id == performed_by_id)
    if date_from:
        q = q.filter(models.AuditLog.performed_at >= date_from)
    if date_to:
        q = q.filter(models.AuditLog.performed_at <= date_to)

    return q


# ─────────────────────────────────────────────────────────────
# GET /audit  — paginated list
# ─────────────────────────────────────────────────────────────

@router.get("")
def list_audit_logs(
    search:           Optional[str]      = Query(None),
    module:           Optional[str]      = Query(None),
    role:             Optional[str]      = Query(None),
    status:           Optional[str]      = Query(None),
    action:           Optional[str]      = Query(None),
    performed_by_id:  Optional[int]      = Query(None),
    date_from:        Optional[datetime] = Query(None),
    date_to:          Optional[datetime] = Query(None),
    # shortcuts
    today:            bool               = Query(False),
    yesterday:        bool               = Query(False),
    this_week:        bool               = Query(False),
    this_month:       bool               = Query(False),
    page:             int                = Query(1, ge=1),
    per_page:         int                = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    # Same IST-vs-UTC boundary issue as audit_stats() below: performed_at is
    # naive UTC, but "Today"/"Yesterday"/etc. must mean the IST calendar day,
    # not the UTC one — otherwise everything before ~5:30 AM IST lands in the
    # wrong bucket. Compute boundaries in IST, then convert back to naive UTC.
    now = datetime.utcnow()
    now_ist = to_india(now)

    def _ist_to_utc_naive(dt_ist: datetime) -> datetime:
        return dt_ist.astimezone(timezone.utc).replace(tzinfo=None)

    if today:
        date_from = _ist_to_utc_naive(now_ist.replace(hour=0, minute=0, second=0, microsecond=0))
        date_to   = now
    elif yesterday:
        d_ist = (now_ist - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        date_from = _ist_to_utc_naive(d_ist)
        date_to   = _ist_to_utc_naive(d_ist.replace(hour=23, minute=59, second=59))
    elif this_week:
        date_from = _ist_to_utc_naive((now_ist - timedelta(days=now_ist.weekday())).replace(hour=0, minute=0, second=0, microsecond=0))
        date_to   = now
    elif this_month:
        date_from = _ist_to_utc_naive(now_ist.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
        date_to   = now

    q = _build_query(db, search, module, role, status, date_from, date_to, action, performed_by_id)
    total = q.with_entities(models.AuditLog.id).count()
    items = (
        q.with_entities(models.AuditLog)
        .order_by(models.AuditLog.performed_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
        "items":    [_serialize(a) for a in items],
    }


# ─────────────────────────────────────────────────────────────
# GET /audit/stats  — dashboard cards
# ─────────────────────────────────────────────────────────────

@router.get("/stats")
def audit_stats(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    # "Today" must mean the current IST calendar day, not the current UTC
    # calendar day — performed_at is stored as naive UTC, and IST is UTC+5:30,
    # so bucketing by UTC midnight misattributed anything logged between
    # midnight and ~5:30 AM IST to the previous day's "Today" count (and
    # conversely counted the same window from the day before as still
    # "today"). Compute IST midnight, then convert back to naive UTC to
    # compare against the naive-UTC performed_at column.
    ist_midnight = to_india(utc_now()).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = ist_midnight.astimezone(timezone.utc).replace(tzinfo=None)

    # Fetch today's logs in one query; Python-side grouping handles NULL module
    # (existing records written before this version have module=NULL — fall back to table_name inference)
    today_logs = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.performed_at >= today_start)
        .all()
    )

    _finance_modules = {"Finance", "Donations", "Expenses", "Funds"}

    def _mod(log: models.AuditLog) -> str:
        return log.module or _infer_module(log.table_name)

    total_today    = len(today_logs)
    critical_today = sum(1 for l in today_logs if (l.status or "success") == "critical")
    failed_logins  = sum(1 for l in today_logs if (l.status or "success") == "failed" and _mod(l) == "Authentication")
    finance_changes= sum(1 for l in today_logs if _mod(l) in _finance_modules)
    system_events  = sum(1 for l in today_logs if _mod(l) == "System")
    user_changes   = sum(1 for l in today_logs if _mod(l) == "Users")

    total_all = db.query(func.count(models.AuditLog.id)).scalar() or 0
    failed_all = db.query(func.count(models.AuditLog.id)).filter(
        models.AuditLog.status == "failed"
    ).scalar() or 0

    # Module breakdown (all time) — group in Python to handle NULL module
    raw = (
        db.query(
            models.AuditLog.module,
            models.AuditLog.table_name,
            func.count(models.AuditLog.id).label("cnt"),
        )
        .group_by(models.AuditLog.module, models.AuditLog.table_name)
        .all()
    )
    mc: dict[str, int] = {}
    for mod, tbl, cnt in raw:
        m = mod or _infer_module(tbl or "")
        mc[m] = mc.get(m, 0) + cnt
    by_module = sorted([{"module": m, "count": c} for m, c in mc.items()], key=lambda x: -x["count"])

    return {
        "total_today":     total_today,
        "critical_today":  critical_today,
        "failed_logins":   failed_logins,
        "finance_changes": finance_changes,
        "total_all":       total_all,
        "failed_all":      failed_all,
        "system_events":   system_events,
        "user_changes":    user_changes,
        "by_module":       by_module,
    }


# ─────────────────────────────────────────────────────────────
# GET /audit/{id}  — single record detail
# ─────────────────────────────────────────────────────────────

@router.get("/{audit_id}")
def get_audit_detail(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    a = db.query(models.AuditLog).filter_by(id=audit_id).first()
    if not a:
        raise HTTPException(404, "Audit log not found")
    return _serialize(a)


# ─────────────────────────────────────────────────────────────
# GET /audit/export/excel — Excel export
# ─────────────────────────────────────────────────────────────

@router.get("/export/excel")
def export_audit_excel(
    search:          Optional[str]      = Query(None),
    module:          Optional[str]      = Query(None),
    role:            Optional[str]      = Query(None),
    status:          Optional[str]      = Query(None),
    action:          Optional[str]      = Query(None),
    performed_by_id: Optional[int]      = Query(None),
    date_from:       Optional[datetime] = Query(None),
    date_to:         Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(500, "openpyxl not installed")

    q = _build_query(db, search, module, role, status, date_from, date_to, action, performed_by_id)
    items = q.order_by(models.AuditLog.performed_at.desc()).limit(10000).all()

    wb = openpyxl.Workbook()

    MODULES = ["Authentication", "Users", "Families", "Prayer", "Finance",
               "Donations", "Expenses", "Announcements", "Questions", "Hadith",
               "Funds", "Notifications", "System"]

    header_fill = PatternFill("solid", fgColor="1E3A5F")
    header_font = Font(color="FFFFFF", bold=True)

    def make_sheet(ws, rows, headers):
        ws.append(headers)
        for cell in ws[1]:
            cell.fill  = header_fill
            cell.font  = header_font
            cell.alignment = Alignment(horizontal="center")
        for row in rows:
            ws.append(row)
        for i, _ in enumerate(headers, 1):
            max_len = max((len(str(ws.cell(r, i).value or "")) for r in range(1, ws.max_row + 1)), default=10)
            ws.column_dimensions[get_column_letter(i)].width = min(max_len + 4, 50)
        ws.freeze_panes = "A2"

    def ts(a):
        return a.performed_at.strftime("%Y-%m-%d %H:%M:%S") if a.performed_at else ""

    # Sheet 1 — All Logs
    ws_all = wb.active
    ws_all.title = "All Logs"
    make_sheet(ws_all, [
        [a.id, ts(a), a.user_fullname or (a.performed_by.name if a.performed_by else ""),
         a.user_role or (a.performed_by.role if a.performed_by else ""),
         _infer_module(a.table_name) if not a.module else a.module,
         a.action_label or a.action, a.description or a.note or "",
         a.status or "success", a.ip_address or "", a.browser or "",
         a.os_name or "", a.device_name or ""]
        for a in items
    ], ["ID", "Timestamp", "User", "Role", "Module", "Action", "Description",
        "Status", "IP Address", "Browser", "OS", "Device"])

    # Per-module sheets
    for mod in MODULES:
        mod_items = [a for a in items if (a.module or _infer_module(a.table_name)) == mod]
        if not mod_items:
            continue
        ws = wb.create_sheet(title=mod[:31])
        make_sheet(ws, [
            [a.id, ts(a), a.user_fullname or (a.performed_by.name if a.performed_by else ""),
             a.action_label or a.action, a.description or a.note or "",
             a.status or "success", a.ip_address or ""]
            for a in mod_items
        ], ["ID", "Timestamp", "User", "Action", "Description", "Status", "IP"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    fname = f"audit_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
