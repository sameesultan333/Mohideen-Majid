# backend/app/routes/finance.py
"""
Central finance module.
Covers: dashboard, ledger, donation purposes, finance settings, reports.
"""

from __future__ import annotations

import io
import time
import calendar
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case, or_
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import SessionLocal
from app.security import get_current_user, require_admin, require_admin_or_collector, require_collector, require_superadmin
from app.utils.chanda_months import (
    current_month_key,
    pending_month_filter,
    visible_month_filter,
)
from app.utils.timezones import india_month_key, utc_now, utc_now_naive, to_india
from app.websocket_manager import manager
from app.services.audit_service import AuditAction

router = APIRouter(prefix="/finance", tags=["Finance"])

# ── 30-second in-memory cache for the dashboard ───────────────
_dashboard_cache: dict = {"data": None, "at": 0.0}
DASHBOARD_CACHE_TTL = 30  # seconds

# Collector Payout: 15% of live Chanda actually received in the month, from
# any source (collector, admin, self pay). Not per-collector — the mosque
# currently has two collectors from the same family and does not split this.
COLLECTOR_PAYOUT_RATE = 0.15


def invalidate_dashboard_cache() -> None:
    """Call this whenever a donation, expense, fund, or setting changes."""
    _dashboard_cache["data"] = None
    _dashboard_cache["at"]   = 0.0


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _current_user_id(current_user: dict) -> int:
    return int(current_user["sub"])


import math as _math

def _sanitize(obj):
    """Recursively replace nan/inf with None so JSON serialization never fails."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float) and (_math.isnan(obj) or _math.isinf(obj)):
        return None
    return obj


# ─────────────────────────────────────────────────────────────
# FINANCE DASHBOARD  (single aggregation endpoint)
# ─────────────────────────────────────────────────────────────

@router.get("/dashboard")
def finance_dashboard(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_collector),
):
    """
    Returns every number the frontend dashboard needs in one request.
    Cached for 30 seconds. Pass ?month=YYYY-MM to override the current month.
    """
    now_ts = time.time()
    if not month and _dashboard_cache["data"] and now_ts - _dashboard_cache["at"] < DASHBOARD_CACHE_TTL:
        return _dashboard_cache["data"]

    target_month = month or india_month_key(utc_now())

    # ── Families & staff ──────────────────────────────────────
    total_families      = db.query(models.ApprovedHead).filter_by(is_active=True).count()
    registered_families = db.query(models.ApprovedHead).filter_by(is_active=True, is_registered=True).count()
    total_members       = db.query(models.User).filter(
        models.User.role.in_(["head", "member"]),
        models.User.is_active == True,
    ).count()
    total_collectors = db.query(models.User).filter_by(role="collector", is_active=True).count()
    total_imams      = db.query(models.User).filter_by(role="imam",      is_active=True).count()
    total_admins     = db.query(models.User).filter(
        models.User.role.in_(["admin", "superadmin"]),
        models.User.is_active == True,
    ).count()

    # ── Current-month chanda (SQL aggregation) ────────────────
    # "Expected" (amount_due) excludes families deactivated before paying —
    # already-paid amounts always count regardless of current active status
    # ("received amount unchanged"), so the exclusion only applies when the
    # row is still unpaid.
    # Same is_active-or-paid condition used for both the row count and the
    # due-amount sum below — a deactivated family's still-existing pending
    # row must not inflate the Pending count either, or "Pending" ends up
    # higher than the actual number of families.
    _active_or_paid = or_(models.ApprovedHead.is_active.is_(True), models.ChandaCollection.status == "paid")
    _chanda_agg = (
        db.query(
            models.ChandaCollection.status,
            func.count(case((_active_or_paid, models.ChandaCollection.id), else_=None)),
            func.coalesce(func.sum(
                case((_active_or_paid, models.ChandaCollection.amount_due), else_=0)
            ), 0.0),
            func.coalesce(func.sum(models.ChandaCollection.total_paid), 0.0),
        )
        .join(models.ApprovedHead, models.ApprovedHead.id == models.ChandaCollection.head_id)
        .filter(
            models.ChandaCollection.month == target_month,
            visible_month_filter(),
        )
        .group_by(models.ChandaCollection.status)
        .all()
    )
    paid_count = pending_count = 0
    due_month = collected_month = 0.0
    for _st, _cnt, _due, _paid in _chanda_agg:
        if _st == "paid":      paid_count    = _cnt
        else:                  pending_count += _cnt
        due_month       += float(_due  or 0)
        collected_month += float(_paid or 0)
    # A family with no ChandaCollection row for target_month is NOT pending —
    # the month simply has not been generated for them. ChandaCollection is the
    # single source of truth; pending is never inferred from the calendar.
    if target_month > current_month_key():
        # Month not generated yet. Only advance payers have a row, so summing
        # amount_due would report a token "Expected" (one payer's ₹1,200 for the
        # whole masjid). Expected is instead the full projection at today's
        # rates — what generation will charge, and it moves only when a family's
        # monthly amount is changed. No family is individually "pending" yet,
        # since none of them has an actual bill for this month — but that is a
        # different question from the projected shortfall, which used to be
        # hardcoded to 0 here regardless of `due`/`collected`. That made a month
        # with real advance collections (say ₹1,200 of a projected ₹60,700) show
        # "Outstanding: 0" right next to two large nonzero numbers, which reads
        # as broken rather than "nothing owed yet".
        due_month = float(
            db.query(func.coalesce(func.sum(models.ApprovedHead.monthly_amount), 0.0))
            .filter(models.ApprovedHead.is_active.is_(True))
            .scalar() or 0
        )
        pending_count = 0
    # Same formula either way: what generation would currently charge, minus
    # what has already been collected against it (including advance payments).
    outstanding = max(due_month - collected_month, 0)
    collection_pct = round((collected_month / due_month * 100) if due_month else 0, 1)

    # ── All-time outstanding (SQL aggregation) ─────────────────
    # Generated months only: a month not yet due cannot be outstanding, and the
    # import's blank future rows must not inflate the total.
    _all_agg = db.query(
        func.coalesce(func.sum(models.ChandaCollection.amount_due), 0.0),
        func.coalesce(func.sum(models.ChandaCollection.total_paid), 0.0),
    ).filter(pending_month_filter()).one()
    total_due_all     = float(_all_agg[0] or 0)
    total_paid_all    = float(_all_agg[1] or 0)
    total_outstanding = max(total_due_all - total_paid_all, 0)

    # ── Defaulters (3-month threshold) ────────────────────────
    defaulters = _count_defaulters(db, 3)

    # ── Donations ─────────────────────────────────────────────
    donation_agg = db.query(
        func.count(models.Donation.id),
        func.coalesce(func.sum(models.Donation.amount), 0.0),
    ).one()
    donations_count = int(donation_agg[0] or 0)
    donations_amt = round(float(donation_agg[1] or 0.0), 2)

    # ── Expenses (only APPROVED expenses affect the balance) ──
    expense_agg = db.query(
        func.count(models.Expense.id),
        func.coalesce(func.sum(models.Expense.amount), 0.0),
    ).filter(
        models.Expense.is_deleted == False,
        models.Expense.approved_at.isnot(None),
    ).one()
    expenses_count = int(expense_agg[0] or 0)
    expenses_amt = round(float(expense_agg[1] or 0.0), 2)

    # Pending (unapproved) expenses — shown separately on dashboard
    pending_expense_agg = db.query(
        func.count(models.Expense.id),
        func.coalesce(func.sum(models.Expense.amount), 0.0),
    ).filter(
        models.Expense.is_deleted == False,
        models.Expense.approved_at.is_(None),
    ).one()
    pending_expenses_count = int(pending_expense_agg[0] or 0)
    pending_expenses_amt = round(float(pending_expense_agg[1] or 0.0), 2)

    # ── Balance (donations - approved expenses only) ──────────
    balance = round(donations_amt - expenses_amt, 2)

    # ── Pending user-submitted verifications ──────────────────
    pending_verification = db.query(models.PaymentEntry).filter(
        models.PaymentEntry.status == "pending",
        models.PaymentEntry.created_by == "user",
    ).count()

    pending_rollbacks = db.query(models.PaymentRollbackRequest).filter(
        models.PaymentRollbackRequest.status == "pending",
    ).count()

    # ── Time-period collection totals ─────────────────────────
    now_dt    = utc_now().replace(tzinfo=None)
    today     = now_dt.date()
    week_start = today - timedelta(days=today.weekday())
    year_start = datetime(today.year, 1, 1)

    PE = models.PaymentEntry
    # Historical/migration rows are real coverage but not a live cash event —
    # see payment_source docs on the model. Every one of these period totals is
    # "actual money received," so migration rows are excluded here the same way
    # for all of them, not just the one that happened to be reported broken.
    _is_live = func.coalesce(PE.payment_source, "app") != "import"

    def _cash_flow(since: datetime, until: datetime) -> dict:
        """`until` is required, not optional. It used to default to "no upper
        bound" when omitted, which meant "today", "this week", "this year" and
        the default (no ?month=) "this month" all silently summed every
        verified payment from `since` to the END OF THE TABLE — including
        every future-dated row the historical importer creates (each stamped
        with the month it covers, so an import of Aug-Dec rows sits ahead of
        "today" in August). That is the exact mechanism that turned a real
        ₹1,800 August collection into ₹5,100 on the overview dashboard, which
        has no ?month= and hit this exact default. Requiring `until` here
        means a future call site cannot reintroduce the same bug by omission.
        """
        amt = PE.amount
        meth = func.lower(func.coalesce(PE.method, "other"))
        q = db.query(
            func.coalesce(func.sum(amt), 0.0).label("total"),
            func.coalesce(func.sum(case((meth == "cash", amt), else_=0)), 0.0).label("cash"),
            func.coalesce(func.sum(case((meth == "upi", amt), else_=0)), 0.0).label("upi"),
            func.coalesce(func.sum(case((meth == "bank", amt), else_=0)), 0.0).label("bank"),
            func.coalesce(func.sum(case((meth == "cheque", amt), else_=0)), 0.0).label("cheque"),
            func.coalesce(func.sum(case((PE.created_by == "user", amt), else_=0)), 0.0).label("online"),
            func.coalesce(func.sum(case((PE.created_by != "user", amt), else_=0)), 0.0).label("collector"),
        ).filter(
            PE.status == "verified",
            _is_live,
            PE.created_at >= since,
            PE.created_at < until,
        )
        r = q.one()
        return {
            "total": round(float(r.total), 2),
            "cash": round(float(r.cash), 2),
            "upi": round(float(r.upi), 2),
            "bank": round(float(r.bank), 2),
            "cheque": round(float(r.cheque), 2),
            "other": round(float(r.total) - float(r.cash) - float(r.upi) - float(r.bank) - float(r.cheque), 2),
            "collector": round(float(r.collector), 2),
            "online": round(float(r.online), 2),
        }

    today_start     = datetime.combine(today, datetime.min.time())
    tomorrow_start  = today_start + timedelta(days=1)
    yesterday_start = today_start - timedelta(days=1)
    week_start_dt   = datetime.combine(week_start, datetime.min.time())
    next_week_start = week_start_dt + timedelta(days=7)
    month_start_dt  = datetime(today.year, today.month, 1)
    next_month_start_dt = datetime(today.year + (today.month == 12), today.month % 12 + 1, 1)
    year_end_dt     = datetime(today.year + 1, 1, 1)

    # When viewing a specific month, show that month's cash flow instead of the current calendar month.
    if month:
        try:
            sel_y, sel_m = map(int, month.split("-"))
            sel_month_start = datetime(sel_y, sel_m, 1)
            sel_month_end   = datetime(sel_y + (sel_m == 12), sel_m % 12 + 1, 1)
            this_month_flow = _cash_flow(sel_month_start, sel_month_end)
        except Exception:
            this_month_flow = _cash_flow(month_start_dt, next_month_start_dt)
    else:
        this_month_flow = _cash_flow(month_start_dt, next_month_start_dt)

    collection_periods = {
        "today":      _cash_flow(today_start, tomorrow_start),
        "yesterday":  _cash_flow(yesterday_start, today_start),
        "this_week":  _cash_flow(week_start_dt, next_week_start),
        "this_month": this_month_flow,
        "this_year":  _cash_flow(year_start, year_end_dt),
    }

    # ── Recent activity (last 10 of each) ─────────────────────
    from sqlalchemy.orm import joinedload as _jl
    # Same ordering rule as the Finance Timeline: the migration stamps imported
    # payments with the month they cover, so importing paid-up-to-December in
    # August leaves rows dated ahead of today. Without the first clause those
    # future rows filled all ten slots and no real collection was ever shown.
    _now = utc_now_naive()
    recent_payments = (
        db.query(models.PaymentEntry)
        .options(_jl(models.PaymentEntry.head))
        .filter(
            models.PaymentEntry.status == "verified",
            # A "Recent Payments" feed means live activity. Without this, a
            # database that is mostly historical-import rows (as this one is)
            # fills all 10 slots with import noise instead of what an admin
            # actually collected recently.
            func.coalesce(models.PaymentEntry.payment_source, "app") != "import",
        )
        .order_by(
            (models.PaymentEntry.created_at <= _now).desc(),
            models.PaymentEntry.created_at.desc(),
        )
        .limit(10).all()
    )
    recent_donations = (
        db.query(models.Donation)
        .order_by(models.Donation.created_at.desc())
        .limit(10).all()
    )
    recent_expenses = (
        db.query(models.Expense)
        .order_by(models.Expense.created_at.desc())
        .limit(10).all()
    )

    result = {  # noqa: E501  (long dict is intentional — single API call for dashboard)
        "month": target_month,
        "is_historical_month": month is not None and month != india_month_key(utc_now()),
        "families": {
            "total": total_families,
            "registered": registered_families,
            "unregistered": total_families - registered_families,
            "pending_registration": total_families - registered_families,
            "total_members": total_members,
            "collectors": total_collectors,
            "imams": total_imams,
            "staff": total_admins,
        },
        "chanda": {
            "paid": paid_count,
            "pending": pending_count,
            "due": round(due_month, 2),
            "collected": round(collected_month, 2),
            "outstanding": round(outstanding, 2),
            "collection_pct": collection_pct,
            "total_outstanding_all_months": round(total_outstanding, 2),
            "defaulters_3m": defaulters,
        },
        # Live Chanda only — PaymentEntry never holds donation/fund amounts
        # (those live in the Donation table), historical/import rows are
        # already excluded from this_month_flow, and rejected/rolled-back
        # payments are already excluded by the status='verified' filter every
        # _cash_flow call carries. So this_month_flow.total is already exactly
        # "eligible live Chanda received this month" with no further filtering.
        "collector_payout": {
            "month": target_month,
            "eligible_live_chanda": this_month_flow["total"],
            "rate": COLLECTOR_PAYOUT_RATE,
            "amount": round(this_month_flow["total"] * COLLECTOR_PAYOUT_RATE, 2),
        },
        "donations": {
            "count": donations_count,
            "total": donations_amt,
        },
        "expenses": {
            "count": expenses_count,
            "total": expenses_amt,
            "pending_count": pending_expenses_count,
            "pending_total": pending_expenses_amt,
        },
        "balance": balance,
        "pending_verification": pending_verification,
        "pending_rollbacks": pending_rollbacks,
        "recent_payments": [
            {
                "id": p.id,
                "receipt_id": p.receipt_id,
                "amount": p.amount,
                "method": p.method,
                "head_name": p.head.name if p.head else None,
                "collected_by": p.collected_by,
                "created_by": p.created_by,
                "created_at": p.created_at,
                "collected_at": p.collected_at,
                "verified_at": p.verified_at,
                "proof_image": p.proof_image,
                "notes": p.notes,
                "transaction_ref": p.transaction_ref,
                "covered_months": p.covered_months or [],
            }
            for p in recent_payments
        ],
        "recent_donations": [
            {
                "id": d.id,
                "donor_name": d.donor_name,
                "amount": d.amount,
                "method": d.method,
                "created_at": d.created_at,
            }
            for d in recent_donations
        ],
        "recent_expenses": [
            {
                "id": e.id,
                "title": e.title,
                "amount": e.amount,
                "category": e.category,
                "created_at": e.created_at,
            }
            for e in recent_expenses
        ],
        "collection_periods": collection_periods,
    }

    result = _sanitize(result)

    if not month:
        _dashboard_cache["data"] = result
        _dashboard_cache["at"]   = time.time()

    return result


def _count_defaulters(db: Session, threshold_months: int) -> int:
    """Count families with threshold_months or more pending generated months.

    Ungenerated future months never count — see utils/chanda_months.
    """
    return (
        db.query(models.ChandaCollection.head_id)
        .join(models.ApprovedHead, models.ApprovedHead.id == models.ChandaCollection.head_id)
        .filter(
            models.ApprovedHead.is_active == True,
            models.ChandaCollection.status != "paid",
            pending_month_filter(),
        )
        .group_by(models.ChandaCollection.head_id)
        .having(func.count(models.ChandaCollection.id) >= threshold_months)
        .count()
    )


# ─────────────────────────────────────────────────────────────
# COLLECTION TRENDS  (weekly rolling window / yearly monthly totals)
# ─────────────────────────────────────────────────────────────

@router.get("/collections/weekly")
def weekly_collections(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Rolling last-7-calendar-days collection total.

    Grouped by `created_at` — the real, server-stamped transaction moment —
    not `collected_at`, which an operator can backdate. This used to coalesce
    to `collected_at` first, so a payment actually taken today but entered
    with an earlier collection date would land on the wrong day here while
    every other "actual money received" figure (cash-flow panel, Finance
    Timeline, receipts) already used `created_at`. Excludes historical/import
    rows the same way: they represent coverage established on migration, not
    money received this week."""
    paid_date = models.PaymentEntry.created_at
    end = to_india(utc_now()).date()
    start = end - timedelta(days=6)

    rows = (
        db.query(func.date(paid_date).label("d"), func.sum(models.PaymentEntry.amount))
        .filter(
            models.PaymentEntry.status == "verified",
            func.coalesce(models.PaymentEntry.payment_source, "app") != "import",
        )
        .filter(func.date(paid_date) >= start, func.date(paid_date) <= end)
        .group_by("d")
        .all()
    )
    by_day = {str(d): float(total) for d, total in rows}
    return [
        {"date": str(start + timedelta(days=i)), "amount": by_day.get(str(start + timedelta(days=i)), 0.0)}
        for i in range(7)
    ]


@router.get("/collections/yearly")
def yearly_collections(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """12 monthly totals (Jan-Dec) for the given year, defaulting to the
    current year. Always returns all 12 slots, zero-filled for months with
    no payments — never omits an empty month.

    Grouped by `created_at`, same reasoning as weekly_collections above: the
    real transaction moment, not the operator-editable collected_at, and
    excluding historical/import rows so a multi-month migration import does
    not appear as revenue landing in whichever months it happens to cover."""
    paid_date = models.PaymentEntry.created_at
    target_year = year or to_india(utc_now()).year

    rows = (
        db.query(func.extract("month", paid_date).label("m"), func.sum(models.PaymentEntry.amount))
        .filter(
            models.PaymentEntry.status == "verified",
            func.coalesce(models.PaymentEntry.payment_source, "app") != "import",
        )
        .filter(func.extract("year", paid_date) == target_year)
        .group_by("m")
        .all()
    )
    by_month = {int(m): float(total) for m, total in rows}
    return {"year": target_year, "months": [by_month.get(m, 0.0) for m in range(1, 13)]}


# ─────────────────────────────────────────────────────────────
# DEFAULTERS  (1 / 3 / 6 / 12 months)
# ─────────────────────────────────────────────────────────────

@router.get("/defaulters")
def get_defaulters(
    months: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Returns defaulters grouped by all thresholds (1, 3, 6, 12 months).
    If ?months=N is passed, also returns a flat filtered list for that threshold.

    Ungenerated future months never count — see utils/chanda_months.
    """
    heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
    head_map = {h.id: h for h in heads}

    pending_cols = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id.in_(list(head_map.keys())),
            models.ChandaCollection.status != "paid",
            pending_month_filter(),
        )
        .all()
    )
    from collections import defaultdict
    by_head: dict[int, list] = defaultdict(list)
    for c in pending_cols:
        by_head[c.head_id].append(c)

    all_items = []
    for hid, cols in by_head.items():
        head = head_map.get(hid)
        if not head:
            continue
        outstanding = sum(max(c.amount_due - c.total_paid, 0) for c in cols)
        all_items.append({
            "family_id":      head.id,
            "chanda_no":      head.chanda_no,
            "name":           head.name,
            "phone":          head.phone,
            "pending_months": len(cols),
            "outstanding":    round(outstanding, 2),
            "months":         sorted(c.month for c in cols),
        })
    all_items.sort(key=lambda x: x["pending_months"], reverse=True)

    # Mutually exclusive buckets — a family belongs to exactly one tier.
    # "1":  exactly 1 month pending
    # "3":  2–3 months pending
    # "6":  4–11 months pending
    # "12": 12+ months pending
    def _bucket(n: int) -> int:
        if n == 1:      return 1
        if n <= 3:      return 3
        if n <= 11:     return 6
        return 12

    grouped: dict[int, list] = {1: [], 3: [], 6: [], 12: []}
    for item in all_items:
        grouped[_bucket(item["pending_months"])].append(item)

    response = {
        "grouped": {
            str(t): {"count": len(v), "items": v}
            for t, v in grouped.items()
        },
    }
    if months is not None:
        filtered = [i for i in all_items if i["pending_months"] >= months]
        response["filtered"] = {"threshold_months": months, "count": len(filtered), "items": filtered}

    return _sanitize(response)


@router.post("/defaulters/notify", response_model=schemas.DefaulterReminderResult)
def notify_defaulters(
    data: schemas.DefaulterReminderRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Push (FCM) reminder to selected defaulters — replaces the old SMS-based
    reminder. Re-derives each family's pending-months count from the same
    query as GET /defaulters rather than trusting a client-supplied number,
    and reuses the existing notify_user() FCM helper (see
    scheduler.job_send_chanda_reminders for the same pattern).

    Ungenerated future months never count — see utils/chanda_months.
    """
    from app.utils.fcm import notify_user

    family_ids = list(dict.fromkeys(data.family_ids))  # de-dupe, preserve order
    if not family_ids:
        return {"requested": 0, "notified": 0, "skipped": []}

    heads = (
        db.query(models.ApprovedHead)
        .filter(models.ApprovedHead.id.in_(family_ids), models.ApprovedHead.is_active == True)
        .all()
    )
    head_map = {h.id: h for h in heads}

    # Pending counts and head users resolved in two aggregate queries rather
    # than two per family — a bulk "notify all defaulters" click used to fan out
    # into hundreds of round-trips before the first push was even sent.
    pending_by_head = dict(
        db.query(
            models.ChandaCollection.head_id,
            func.count(models.ChandaCollection.id),
        )
        .filter(
            models.ChandaCollection.head_id.in_(family_ids),
            models.ChandaCollection.status != "paid",
            pending_month_filter(),
        )
        .group_by(models.ChandaCollection.head_id)
        .all()
    )
    users_by_head = {
        u.family_id: u
        for u in db.query(models.User).filter(
            models.User.family_id.in_(family_ids),
            models.User.role == "head",
            models.User.is_active == True,
        ).all()
    }

    notified = 0
    skipped: list[int] = []
    for fid in family_ids:
        head = head_map.get(fid)
        if not head:
            skipped.append(fid)
            continue

        pending = pending_by_head.get(fid, 0)
        if pending == 0:
            skipped.append(fid)
            continue

        user = users_by_head.get(fid)
        if not user:
            skipped.append(fid)
            continue

        months_word = "month" if pending == 1 else "months"
        title = "Chanda Contribution Reminder"
        body = (
            "Assalamu Alaikum.\n\n"
            f"Our records show that your Chanda contribution has been pending for {pending} {months_word}. "
            "Please contribute through the My Ummah app or directly at the mosque.\n\n"
            "May Allah reward you for your contribution."
        )
        sent = notify_user(db, user.id, title, body, data={"type": "chanda_reminder", "family_id": str(fid)})
        if sent:
            notified += 1
        else:
            skipped.append(fid)

    return {"requested": len(family_ids), "notified": notified, "skipped": skipped}


# ─────────────────────────────────────────────────────────────
# LEDGER  (FinanceTransaction log)
# ─────────────────────────────────────────────────────────────

@router.get("/ledger")
def get_ledger(
    page: int = 1,
    per_page: int = 50,
    transaction_type: Optional[str] = None,
    direction: Optional[str] = None,
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.FinanceTransaction)
    if transaction_type:
        q = q.filter_by(transaction_type=transaction_type)
    if direction:
        q = q.filter_by(direction=direction)
    if month:
        q = q.filter_by(month=month)

    total = q.count()
    items = (
        q.order_by(models.FinanceTransaction.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id":               t.id,
                "transaction_type": t.transaction_type,
                "direction":        t.direction,
                "amount":           t.amount,
                "month":            t.month,
                "receipt_number":   t.receipt_number,
                "note":             t.note,
                "created_at":       t.created_at,
                "family":           t.family.name if t.family else None,
            }
            for t in items
        ],
    }


def write_ledger(
    db: Session,
    transaction_type: str,
    direction: str,
    amount: float,
    *,
    family_id: int = None,
    user_id: int = None,
    payment_entry_id: int = None,
    donation_id: int = None,
    expense_id: int = None,
    receipt_number: str = None,
    month: str = None,
    note: str = None,
    created_by_id: int = None,
) -> models.FinanceTransaction:
    entry = models.FinanceTransaction(
        transaction_type=transaction_type,
        direction=direction,
        amount=amount,
        family_id=family_id,
        user_id=user_id,
        payment_entry_id=payment_entry_id,
        donation_id=donation_id,
        expense_id=expense_id,
        receipt_number=receipt_number,
        month=month,
        note=note,
        created_by_id=created_by_id,
    )
    db.add(entry)
    return entry


# ─────────────────────────────────────────────────────────────
# DONATION PURPOSES
# ─────────────────────────────────────────────────────────────

@router.get("/donation-purposes")
def list_purposes(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Returns each purpose with collected amount, donor count, and progress %."""
    q = db.query(models.DonationPurpose)
    if not include_archived:
        q = q.filter_by(is_archived=False)
    purposes = q.order_by(models.DonationPurpose.name).all()

    result = []
    for p in purposes:
        donations = db.query(models.Donation).filter_by(purpose_id=p.id).all()
        collected = round(sum(d.amount for d in donations), 2)
        target    = float(p.target_amount) if p.target_amount else None
        progress  = round(collected / target * 100, 1) if target and target > 0 else None
        result.append({
            "id":            p.id,
            "name":          p.name,
            "description":   p.description,
            "target_amount": target,
            "is_active":     p.is_active,
            "is_archived":   p.is_archived,
            "created_at":    p.created_at,
            "created_by_id": p.created_by_id,
            # analytics
            "collected":       collected,
            "donor_count":     len(donations),
            "progress_pct":    progress,
            "remaining":       round(target - collected, 2) if target else None,
        })
    return _sanitize(result)


@router.post("/donation-purposes", status_code=201, response_model=schemas.DonationPurposeOut)
def create_purpose(
    data: schemas.DonationPurposeCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    name = data.name.strip()
    if db.query(models.DonationPurpose).filter_by(name=name).first():
        raise HTTPException(400, f"Purpose '{name}' already exists")

    purpose = models.DonationPurpose(
        name=name,
        description=data.description,
        target_amount=data.target_amount,
        is_active=data.is_active,
        created_by_id=_current_user_id(current_user),
    )
    db.add(purpose)
    db.commit()
    db.refresh(purpose)
    manager.publish_sync("admin", "settings_updated", {"resource": "donation_purpose", "id": purpose.id})
    manager.publish_sync("finance", "purpose_created", {"purpose_id": purpose.id, "name": purpose.name})
    return purpose


@router.put("/donation-purposes/{purpose_id}", response_model=schemas.DonationPurposeOut)
def update_purpose(
    purpose_id: int,
    data: schemas.DonationPurposeUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    purpose = db.query(models.DonationPurpose).filter_by(id=purpose_id).first()
    if not purpose:
        raise HTTPException(404, "Purpose not found")

    if data.name is not None:
        new_name = data.name.strip()
        conflict = db.query(models.DonationPurpose).filter(
            models.DonationPurpose.name == new_name,
            models.DonationPurpose.id != purpose_id,
        ).first()
        if conflict:
            raise HTTPException(400, "Name already in use")
        purpose.name = new_name

    if data.description  is not None: purpose.description  = data.description
    if data.target_amount is not None: purpose.target_amount = data.target_amount
    if data.is_active    is not None: purpose.is_active     = data.is_active

    db.commit()
    db.refresh(purpose)
    manager.publish_sync("finance", "purpose_updated", {"purpose_id": purpose.id})
    return purpose


@router.delete("/donation-purposes/{purpose_id}")
def archive_purpose(
    purpose_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    purpose = db.query(models.DonationPurpose).filter_by(id=purpose_id).first()
    if not purpose:
        raise HTTPException(404, "Purpose not found")
    purpose.is_archived = True
    purpose.is_active   = False
    db.commit()
    manager.publish_sync("finance", "purpose_archived", {"purpose_id": purpose.id})
    return {"message": "Purpose archived"}


# ─────────────────────────────────────────────────────────────
# FINANCE SETTINGS
# ─────────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {
    "mosque_name":    "Mohideen Masjid",
    "mosque_address": "",
    "mosque_phone":   "",
    "upi_id":         "",
    "payee_name":     "Mohideen Masjid",
    "bank_account":   "",   # "Bank Name | A/C XXXXXXXX | IFSC XXXXXX"
    "receipt_footer": "",
    "logo_url":       "",   # Cloudinary or local URL for mosque logo
    "sms_template_reminder": "Dear {name}, your chanda of ₹{amount} for {month} is pending. - {mosque}",
}
ALLOWED_SETTING_KEYS = set(_DEFAULT_SETTINGS.keys())


@router.get("/settings/public")
def get_public_settings(db: Session = Depends(get_db)):
    """Returns non-sensitive settings accessible to any logged-in user (UPI ID, payee name)."""
    keys = ["upi_id", "payee_name"]
    rows = db.query(models.FinanceSetting).filter(models.FinanceSetting.key.in_(keys)).all()
    result = {k: _DEFAULT_SETTINGS.get(k, "") for k in keys}
    for row in rows:
        result[row.key] = row.value
    return result


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rows = db.query(models.FinanceSetting).all()
    result = dict(_DEFAULT_SETTINGS)
    for row in rows:
        result[row.key] = row.value
    return result


@router.put("/settings")
def update_settings(
    data: schemas.FinanceSettingUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    user_id = _current_user_id(current_user)
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    unknown = set(updates) - ALLOWED_SETTING_KEYS
    if unknown:
        raise HTTPException(400, f"Unknown setting keys: {sorted(unknown)}. Allowed: {sorted(ALLOWED_SETTING_KEYS)}")
    for key, value in updates.items():
        row = db.query(models.FinanceSetting).filter_by(key=key).first()
        if row:
            row.value         = str(value)
            row.updated_by_id = user_id
        else:
            db.add(models.FinanceSetting(key=key, value=str(value), updated_by_id=user_id))
    db.commit()
    invalidate_dashboard_cache()
    manager.publish_sync("admin", "settings_updated", {"resource": "finance_settings"})
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"message": "Settings saved"}


# ─────────────────────────────────────────────────────────────
# REPORTS
# ─────────────────────────────────────────────────────────────

@router.get("/reports/monthly/{month}")
def monthly_report(
    month: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Full month finance report — data suitable for PDF/Excel export.

    Generated months only — an ungenerated future month reports no pending rows
    (see utils/chanda_months).
    """
    cols = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.month == month,
            visible_month_filter(),
        )
        .all()
    )

    # Bulk-load heads instead of one query per collection row (N+1).
    head_ids = {c.head_id for c in cols if c.head_id}
    heads_by_id = {
        h.id: h for h in db.query(models.ApprovedHead).filter(models.ApprovedHead.id.in_(head_ids)).all()
    } if head_ids else {}

    rows = []
    for c in cols:
        head = heads_by_id.get(c.head_id)
        rows.append({
            "chanda_no":    head.chanda_no if head else None,
            "name":         head.name      if head else None,
            "phone":        head.phone     if head else None,
            "zone":         head.zone      if head else None,
            "amount_due":   c.amount_due,
            "total_paid":   c.total_paid,
            "balance":      round(max(c.amount_due - c.total_paid, 0), 2),
            "status":       c.status,
        })

    paid_rows    = [r for r in rows if r["status"] == "paid"]
    pending_rows = [r for r in rows if r["status"] == "pending"]

    total_due       = sum(r["amount_due"] for r in rows)
    total_collected = sum(r["total_paid"] for r in rows)
    total_balance   = sum(r["balance"]    for r in rows)

    donations = db.query(models.Donation).filter(
        func.to_char(models.Donation.created_at, "YYYY-MM") == month
    ).all()
    expenses  = db.query(models.Expense).filter(
        func.to_char(models.Expense.created_at, "YYYY-MM") == month,
        models.Expense.is_deleted == False,
        models.Expense.approved_at.isnot(None),
    ).all()

    return _sanitize({
        "month":            month,
        "summary": {
            "total_families":  len(rows),
            "paid":            len(paid_rows),
            "pending":         len(pending_rows),
            "total_due":       round(total_due, 2),
            "total_collected": round(total_collected, 2),
            "total_balance":   round(total_balance, 2),
            "collection_pct":  round((total_collected / total_due * 100) if total_due else 0, 1),
        },
        "collections": rows,
        "donations": [
            {"donor_name": d.donor_name, "amount": d.amount, "method": d.method}
            for d in donations
        ],
        "expenses": [
            {"title": e.title, "amount": e.amount, "category": e.category}
            for e in expenses
        ],
        "donations_total": round(sum(d.amount for d in donations), 2),
        "expenses_total":  round(sum(e.amount for e in expenses), 2),
    })


@router.get("/reports/family/{family_id}")
def family_statement(
    family_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """Full payment history for one family.

    Shows generated months plus any future month actually paid in advance;
    unpaid ungenerated months are excluded — see utils/chanda_months.
    """
    current_month = current_month_key()
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")

    cols = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id == head.id,
            visible_month_filter(current_month),
        )
        .order_by(models.ChandaCollection.month)
        .all()
    )
    payments = (
        db.query(models.PaymentEntry)
        .filter_by(head_id=head.id)
        .order_by(models.PaymentEntry.created_at)
        .all()
    )
    donations = db.query(models.Donation).filter_by(head_id=head.id).all()

    # Money owed is measured over generated months only — a month paid in
    # advance is shown in `cols` but is not yet due, so it must not move
    # total_due or outstanding. Advance cash is reported separately.
    due_cols        = [c for c in cols if c.month <= current_month]
    total_due       = sum(c.amount_due for c in due_cols)
    total_paid      = sum(c.total_paid for c in due_cols)
    advance_paid    = sum(c.total_paid for c in cols if c.month > current_month)
    total_outstanding = max(total_due - total_paid, 0)

    # last payment info
    last_payment = payments[-1] if payments else None
    last_payment_date = last_payment.created_at if last_payment else None
    last_collector    = last_payment.collected_by if last_payment else None

    # average days from month start to payment date (only paid months)
    delay_days = []
    for p in payments:
        if p.status == "verified" and p.covered_months:
            try:
                month_start = datetime.strptime(p.covered_months[0], "%Y-%m")
                delta = (p.created_at - month_start).days
                if delta >= 0:
                    delay_days.append(delta)
            except Exception:
                pass
    avg_payment_delay = round(sum(delay_days) / len(delay_days), 1) if delay_days else None

    return _sanitize({
        "family": {
            "id":             head.id,
            "chanda_no":      head.chanda_no,
            "name":           head.name,
            "phone":          head.phone,
            "address":        head.address,
            "monthly_amount": head.monthly_amount,
            "is_active":      head.is_active,
        },
        "summary": {
            "total_months":           len(cols),
            # Paid counts every month settled, advance months included.
            "paid_months":            sum(1 for c in cols if c.status == "paid"),
            # Partial/pending only ever describe generated months.
            "pending_months":         sum(1 for c in due_cols if c.status == "pending"),
            "total_due":              round(total_due, 2),
            "total_paid":             round(total_paid, 2),
            "advance_paid":           round(advance_paid, 2),
            "total_outstanding":      round(total_outstanding, 2),
            "last_payment":           last_payment_date,
            "last_payment_amount":    last_payment.amount if last_payment else None,
            "last_payment_method":    last_payment.method if last_payment else None,
            "last_payment_proof":     last_payment.proof_image if last_payment else None,
            "last_payment_status":    last_payment.status if last_payment else None,
            "avg_payment_delay_days": avg_payment_delay,
            "last_collector":         last_collector,
        },
        "collections": [
            {
                "month":             c.month,
                "amount_due":        c.amount_due,
                "total_paid":        c.total_paid,
                "balance":           round(max(c.amount_due - c.total_paid, 0), 2),
                "status":            c.status,
                "is_advance":        c.is_advance or False,
                "rate_snapshot":     c.rate_snapshot,
                "advance_payment_id": c.advance_payment_id,
            }
            for c in cols
        ],
        "payments": [
            {
                "id":                    p.id,
                "receipt_id":            p.receipt_id,
                "amount":                p.amount,
                "method":                p.method,
                "status":                p.status,
                "collected_by":          p.collected_by,
                "created_at":            p.created_at,
                "collected_at":          p.collected_at,
                "covered_months":        sorted(p.covered_months or []),
                "proof_image":           p.proof_image,
                "transaction_ref":       p.transaction_ref,
                "purpose":               p.purpose,
                "monthly_rate_snapshot": p.monthly_rate_snapshot,
                "is_advance": bool(
                    p.collected_at and p.covered_months and
                    sorted(p.covered_months)[-1] > india_month_key(p.collected_at)
                ),
                # Missing here meant the admin UI's family-statement view had
                # no way to distinguish a multi-month historical migration
                # import from a genuine live advance payment - both showed the
                # same "ADVANCE · N MONTHS" badge, which reads as a collector
                # having taken a real cash advance. created_by was already
                # referenced by that same UI (Self-paid / Collector) but was
                # never actually sent either.
                "payment_source": p.payment_source or "app",
                "created_by":     p.created_by,
            }
            for p in payments
        ],
        "donations": [
            {"id": d.id, "amount": d.amount, "method": d.method, "created_at": d.created_at}
            for d in donations
        ],
    })


@router.get("/reports/donations")
def donation_report(
    month: Optional[str] = None,
    purpose_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.Donation)
    if month:
        q = q.filter(func.to_char(models.Donation.created_at, "YYYY-MM") == month)
    if purpose_id:
        q = q.filter_by(purpose_id=purpose_id)

    donations = q.order_by(models.Donation.created_at.desc()).all()
    total     = sum(d.amount for d in donations)

    by_method: dict[str, float] = {}
    for d in donations:
        by_method[d.method] = round(by_method.get(d.method, 0) + d.amount, 2)

    return _sanitize({
        "count":     len(donations),
        "total":     round(total, 2),
        "by_method": by_method,
        "items": [
            {
                "id":          d.id,
                "donor_name":  d.donor_name,
                "amount":      d.amount,
                "method":      d.method,
                "purpose":     d.purpose_rel.name if d.purpose_rel else None,
                "receipt_id":  d.receipt_id,
                "created_at":  d.created_at,
            }
            for d in donations
        ],
    })


@router.get("/reports/expenses")
def expense_report(
    month: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.Expense)
    if month:
        q = q.filter(func.to_char(models.Expense.created_at, "YYYY-MM") == month)
    if category:
        q = q.filter_by(category=category)

    expenses = q.order_by(models.Expense.created_at.desc()).all()
    total    = sum(e.amount for e in expenses)

    by_category: dict[str, float] = {}
    for e in expenses:
        k = e.category or "Uncategorized"
        by_category[k] = round(by_category.get(k, 0) + e.amount, 2)

    return _sanitize({
        "count":       len(expenses),
        "total":       round(total, 2),
        "by_category": by_category,
        "items": [
            {
                "id":           e.id,
                "title":        e.title,
                "amount":       e.amount,
                "category":     e.category,
                "note":         e.note,
                "receipt_image": e.receipt_image,
                "created_by":   e.created_by,
                "created_at":   e.created_at,
            }
            for e in expenses
        ],
    })


# ─────────────────────────────────────────────────────────────
# PDF GENERATION
# ─────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(models.FinanceSetting).filter_by(key=key).first()
    return row.value if row else _DEFAULT_SETTINGS.get(key, default)


@router.get("/reports/monthly/{month}/pdf")
def monthly_report_pdf(
    month: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
        )
    except ImportError:
        raise HTTPException(500, "reportlab not installed. Run: pip install reportlab")

    data = monthly_report(month, db, current_user)
    mosque_name = _get_setting(db, "mosque_name")
    footer_text = _get_setting(db, "receipt_footer")

    buf = io.BytesIO()
    # Symmetric A4 margins so the page reads as a printed document and nothing
    # sits near the trim edge when it comes out of a printer.
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=1.6*cm, bottomMargin=1.6*cm,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        title="Chanda Collection Report", author="Mohideen Masjid",
    )
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph(mosque_name, styles["Title"]))
    elements.append(Paragraph(f"Monthly Chanda Report — {month}", styles["Heading2"]))
    elements.append(Spacer(1, 0.4*cm))

    s = data["summary"]
    summary_data = [
        ["Families", str(s["total_families"])],
        ["Paid",     str(s["paid"])],
        ["Pending",  str(s["pending"])],
        ["Total Due",       f"₹{s['total_due']:,.2f}"],
        ["Total Collected", f"₹{s['total_collected']:,.2f}"],
        ["Balance",         f"₹{s['total_balance']:,.2f}"],
        ["Collection %",    f"{s['collection_pct']}%"],
    ]
    t = Table(summary_data, colWidths=[5*cm, 5*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
        ("FONTNAME",   (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",   (0, 0), (-1, -1), 10),
        ("GRID",       (0, 0), (-1, -1), 0.5, colors.grey),
        ("PADDING",    (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.6*cm))

    elements.append(Paragraph("Collection Details", styles["Heading3"]))
    col_header = ["#", "Chanda No", "Family Name", "Zone", "Monthly (₹)", "Paid (₹)", "Due (₹)", "Status"]
    col_rows   = [col_header] + [
        [
            str(i + 1),
            r["chanda_no"] or "",
            r["name"] or "",
            r.get("zone") or "—",
            f"{r['amount_due']:,.0f}",
            f"{r['total_paid']:,.0f}",
            f"{max(r['amount_due'] - r['total_paid'], 0):,.0f}",
            r["status"].title(),
        ]
        for i, r in enumerate(data["collections"])
    ]
    col_table = Table(
        col_rows,
        colWidths=[0.9*cm, 2.4*cm, 5.4*cm, 2.4*cm, 2.3*cm, 2.3*cm, 2.3*cm, 1.8*cm],
        repeatRows=1,   # header repeats on every page break
    )
    # Business-report styling: no heavy grid, numerals right-aligned on a mono
    # face so columns line up, hairline rules between rows only, and generous
    # cell padding. A full grid plus centred numbers is what made the old table
    # read as a spreadsheet dump rather than a printed report.
    col_table.setStyle(TableStyle([
        # Header
        ("BACKGROUND",    (0, 0), (-1, 0), colors.HexColor("#0F5C4C")),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING",    (0, 0), (-1, 0), 7),
        # Body
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 8.5),
        ("TEXTCOLOR",     (0, 1), (-1, -1), colors.HexColor("#1C231F")),
        ("TOPPADDING",    (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 7),
        # Money columns: monospaced and right-aligned so digits align.
        ("FONTNAME",      (4, 1), (6, -1), "Courier"),
        ("ALIGN",         (4, 0), (6, -1), "RIGHT"),
        ("ALIGN",         (0, 0), (0, -1), "RIGHT"),
        ("ALIGN",         (7, 0), (7, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        # Rules: hairlines between rows, a rule under the header, no vertical grid.
        ("LINEBELOW",     (0, 0), (-1, 0), 0.9, colors.HexColor("#0F5C4C")),
        ("LINEBELOW",     (0, 1), (-1, -2), 0.25, colors.HexColor("#DFDACB")),
        ("LINEBELOW",     (0, -1), (-1, -1), 0.7, colors.HexColor("#B8B09A")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAF9F4")]),
    ]))
    elements.append(col_table)

    if footer_text:
        elements.append(Spacer(1, 0.8*cm))
        elements.append(Paragraph(footer_text, styles["Normal"]))

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=chanda_{month}.pdf"},
    )


@router.get("/reports/family/{family_id}/pdf")
def family_statement_pdf(
    family_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    except ImportError:
        raise HTTPException(500, "reportlab not installed. Run: pip install reportlab")

    data        = family_statement(family_id, db, current_user)
    mosque_name = _get_setting(db, "mosque_name")
    family      = data["family"]
    s           = data["summary"]

    buf = io.BytesIO()
    # Symmetric A4 margins so the page reads as a printed document and nothing
    # sits near the trim edge when it comes out of a printer.
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=1.6*cm, bottomMargin=1.6*cm,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        title="Chanda Collection Report", author="Mohideen Masjid",
    )
    styles   = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph(mosque_name, styles["Title"]))
    elements.append(Paragraph(f"Family Statement — {family['name']}", styles["Heading2"]))
    elements.append(Paragraph(
        f"Chanda No: {family['chanda_no']}  |  Phone: {family['phone']}  |  Monthly: ₹{family['monthly_amount']:,.2f}",
        styles["Normal"],
    ))
    elements.append(Spacer(1, 0.5*cm))

    summary_data = [
        ["Total Months",    str(s["total_months"])],
        ["Paid",            str(s["paid_months"])],
        ["Pending",         str(s["pending_months"])],
        ["Total Due",       f"₹{s['total_due']:,.2f}"],
        ["Total Paid",      f"₹{s['total_paid']:,.2f}"],
        ["Outstanding",     f"₹{s['total_outstanding']:,.2f}"],
    ]
    t = Table(summary_data, colWidths=[5*cm, 5*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
        ("GRID",       (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME",   (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",   (0, 0), (-1, -1), 10),
        ("PADDING",    (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.6*cm))

    elements.append(Paragraph("Monthly Collections", styles["Heading3"]))
    rows = [["Month", "Due (₹)", "Paid (₹)", "Balance (₹)", "Status"]] + [
        [c["month"], f"{c['amount_due']:,.2f}", f"{c['total_paid']:,.2f}", f"{c['balance']:,.2f}", c["status"].upper()]
        for c in data["collections"]
    ]
    col_table = Table(rows, colWidths=[3*cm, 3.5*cm, 3.5*cm, 3.5*cm, 3.5*cm])
    col_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F5C4C")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("GRID",       (0, 0), (-1, -1), 0.4, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5EF")]),
        ("PADDING",    (0, 0), (-1, -1), 5),
    ]))
    elements.append(col_table)

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=statement_{family_id}.pdf"},
    )


# ─────────────────────────────────────────────────────────────
# EXCEL EXPORTS  (mosques love Excel)
# ─────────────────────────────────────────────────────────────

def _xl_response(wb, filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _xl_header_style(ws, headers: list[str], col_widths: list[int]):
    try:
        from openpyxl.styles import Font, PatternFill, Alignment
        header_fill = PatternFill("solid", fgColor="0F5C4C")
        header_font = Font(bold=True, color="FFFFFF")
    except ImportError:
        header_fill = header_font = None

    ws.append(headers)
    if header_fill:
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center")
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w


@router.get("/reports/monthly/{month}/excel")
def monthly_report_excel(
    month: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "openpyxl not installed. Run: pip install openpyxl")

    data        = monthly_report(month, db, current_user)
    mosque_name = _get_setting(db, "mosque_name")

    wb = openpyxl.Workbook()

    # ── Collections sheet ──────────────────────────────────────
    ws = wb.active
    ws.title = "Collections"
    ws["A1"] = mosque_name
    ws["A2"] = f"Monthly Chanda Report — {month}"
    ws.append([])

    s = data["summary"]
    ws.append(["Summary"])
    for k, v in [
        ("Total Families", s["total_families"]),
        ("Paid",           s["paid"]),
        ("Pending",        s["pending"]),
        ("Total Due",      s["total_due"]),
        ("Total Collected",s["total_collected"]),
        ("Balance",        s["total_balance"]),
        ("Collection %",   f"{s['collection_pct']}%"),
    ]:
        ws.append([k, v])
    ws.append([])

    _xl_header_style(
        ws,
        ["#", "Chanda No", "Family Name", "Zone", "Monthly (₹)", "Paid (₹)", "Due (₹)", "Status"],
        [5, 12, 26, 14, 13, 13, 13, 10],
    )
    for i, r in enumerate(data["collections"], 1):
        ws.append([
            i, r["chanda_no"], r["name"], r.get("zone") or "",
            r["amount_due"], r["total_paid"],
            max(r["amount_due"] - r["total_paid"], 0),
            r["status"].title(),
        ])

    # ── Donations sheet ────────────────────────────────────────
    ws2 = wb.create_sheet("Donations")
    _xl_header_style(ws2, ["Donor", "Amount (₹)", "Method", "Date"], [25, 14, 10, 18])
    for d in data["donations"]:
        ws2.append([d["donor_name"], d["amount"], d["method"], ""])

    # ── Expenses sheet ─────────────────────────────────────────
    ws3 = wb.create_sheet("Expenses")
    _xl_header_style(ws3, ["Title", "Amount (₹)", "Category"], [30, 14, 18])
    for e in data["expenses"]:
        ws3.append([e["title"], e["amount"], e.get("category", "")])

    return _xl_response(wb, f"chanda_{month}.xlsx")


@router.get("/reports/family/{family_id}/excel")
def family_statement_excel(
    family_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "openpyxl not installed. Run: pip install openpyxl")

    data   = family_statement(family_id, db, current_user)
    family = data["family"]
    s      = data["summary"]
    mosque = _get_setting(db, "mosque_name")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Statement"

    ws["A1"] = mosque
    ws["A2"] = f"Family Statement — {family['name']}"
    ws["A3"] = f"Chanda No: {family['chanda_no']}  |  Phone: {family['phone']}"
    ws.append([])

    for k, v in [
        ("Total Months",    s["total_months"]),
        ("Paid",            s["paid_months"]),
        ("Pending",         s["pending_months"]),
        ("Total Due",       s["total_due"]),
        ("Total Paid",      s["total_paid"]),
        ("Outstanding",     s["total_outstanding"]),
    ]:
        ws.append([k, v])
    ws.append([])

    _xl_header_style(ws, ["Month", "Due (₹)", "Paid (₹)", "Balance (₹)", "Status"],
                     [12, 12, 12, 14, 10])
    for c in data["collections"]:
        ws.append([c["month"], c["amount_due"], c["total_paid"], c["balance"], c["status"].upper()])

    ws2 = wb.create_sheet("Payments")
    _xl_header_style(ws2, ["Receipt ID", "Amount (₹)", "Method", "Status", "Months Covered", "Date"],
                     [18, 12, 10, 10, 18, 18])
    for p in data["payments"]:
        ws2.append([p["receipt_id"], p["amount"], p["method"], p["status"],
                    ", ".join(p.get("covered_months") or []), str(p["created_at"])[:19]])

    return _xl_response(wb, f"statement_{family_id}.xlsx")


@router.get("/reports/donations/excel")
def donation_report_excel(
    month: Optional[str] = None,
    purpose_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "openpyxl not installed. Run: pip install openpyxl")

    data = donation_report(month, purpose_id, db, current_user)
    wb   = openpyxl.Workbook()
    ws   = wb.active
    ws.title = "Donations"
    ws["A1"] = f"Donations Report{' — ' + month if month else ''}"
    ws["A2"] = f"Total: ₹{data['total']:,.2f}  |  Count: {data['count']}"
    ws.append([])

    _xl_header_style(ws, ["Donor", "Amount (₹)", "Method", "Purpose", "Receipt ID", "Date"],
                     [25, 12, 10, 20, 18, 18])
    for d in data["items"]:
        ws.append([d["donor_name"], d["amount"], d["method"],
                   d.get("purpose") or "", d.get("receipt_id") or "", str(d["created_at"])[:19]])

    return _xl_response(wb, f"donations{('_' + month) if month else ''}.xlsx")


# ─────────────────────────────────────────────────────────────
# AUDIT LOG
# ─────────────────────────────────────────────────────────────

@router.get("/audit")
def get_audit_log(
    table_name: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.AuditLog)
    if table_name:
        q = q.filter_by(table_name=table_name)
    total = q.count()
    items = q.order_by(models.AuditLog.performed_at.desc()).offset((page-1)*per_page).limit(per_page).all()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id":           a.id,
                "table_name":   a.table_name,
                "record_id":    a.record_id,
                "action":       a.action,
                "old_values":   a.old_values,
                "new_values":   a.new_values,
                "performed_by": a.performed_by.name if a.performed_by else None,
                "performed_at": a.performed_at,
                "ip_address":   a.ip_address,
                "note":         a.note,
            }
            for a in items
        ],
    }


# ─────────────────────────────────────────────────────────────
# SMS QUEUE
# ─────────────────────────────────────────────────────────────

@router.get("/sms-queue")
def get_sms_queue(
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.SmsQueue)
    if status:
        q = q.filter_by(status=status)
    total = q.count()
    items = q.order_by(models.SmsQueue.created_at.desc()).offset((page-1)*per_page).limit(per_page).all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "items": [
            {
                "id":           s.id,
                "phone":        s.phone,
                "message":      s.message,
                "status":       s.status,
                "attempts":     s.attempts,
                "last_error":   s.last_error,
                "scheduled_at": s.scheduled_at,
                "sent_at":      s.sent_at,
            }
            for s in items
        ],
    }


@router.post("/sms-queue/retry")
def retry_failed_sms(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    """Reset failed/expired SMS entries so the next scheduler run retries them."""
    updated = db.query(models.SmsQueue).filter(
        models.SmsQueue.status.in_(["failed", "expired"])
    ).update(
        {"status": "queued", "attempts": 0, "last_error": None},
        synchronize_session=False,
    )
    db.commit()
    return {"message": f"Reset {updated} SMS entries to queued"}


# SMS statuses: queued → sending → delivered | failed | expired
# queued: waiting to be picked up by scheduler
# sending: currently being dispatched (in-flight)
# delivered: confirmed by provider
# failed: all retries exhausted
# expired: scheduled_at too old, no longer worth sending


@router.get("/reports/analytics")
def analytics_report(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Top donors, monthly trend (12 months), yearly trend, purpose-wise totals,
    expense category breakdown, collector performance.
    """
    from collections import defaultdict

    # ── Top donors (all-time, top 10) ─────────────────────────
    all_donations = db.query(models.Donation).all()
    donor_totals: dict[str, float] = defaultdict(float)
    for d in all_donations:
        donor_totals[d.donor_name] += d.amount
    top_donors = sorted(
        [{"name": k, "total": round(v, 2)} for k, v in donor_totals.items()],
        key=lambda x: x["total"], reverse=True,
    )[:10]

    # ── Monthly trend — chanda collected, last 12 calendar months ─
    now_dt     = utc_now().replace(tzinfo=None)
    monthly_trend = []
    for i in range(11, -1, -1):
        # build month key going back i months from today
        yr       = now_dt.year
        mo       = now_dt.month - i
        while mo <= 0:
            mo += 12
            yr -= 1
        month_key = f"{yr}-{mo:02d}"
        cols  = db.query(models.ChandaCollection).filter_by(month=month_key).all()
        monthly_trend.append({
            "month":     month_key,
            "collected": round(sum(c.total_paid for c in cols), 2),
            "due":       round(sum(c.amount_due for c in cols), 2),
            "families":  len(cols),
        })

    # ── Yearly trend ───────────────────────────────────────────
    all_payments = db.query(models.PaymentEntry).filter_by(status="verified").all()
    yearly_chanda: dict[int, float] = defaultdict(float)
    for p in all_payments:
        if p.created_at:
            yearly_chanda[p.created_at.year] += p.amount
    all_expense_records = db.query(models.Expense).all()
    yearly_expense: dict[int, float] = defaultdict(float)
    for e in all_expense_records:
        if e.created_at:
            yearly_expense[e.created_at.year] += e.amount
    yearly_donation: dict[int, float] = defaultdict(float)
    for d in all_donations:
        if d.created_at:
            yearly_donation[d.created_at.year] += d.amount
    all_years = sorted(set(yearly_chanda) | set(yearly_expense) | set(yearly_donation))
    yearly_trend = [
        {
            "year":      y,
            "chanda":    round(yearly_chanda.get(y, 0), 2),
            "donations": round(yearly_donation.get(y, 0), 2),
            "expenses":  round(yearly_expense.get(y, 0), 2),
        }
        for y in all_years
    ]

    # ── Purpose-wise donations ─────────────────────────────────
    purposes = db.query(models.DonationPurpose).filter_by(is_archived=False).all()
    purpose_wise = []
    for p in purposes:
        pdonations = db.query(models.Donation).filter_by(purpose_id=p.id).all()
        collected  = round(sum(d.amount for d in pdonations), 2)
        target     = float(p.target_amount) if p.target_amount else None
        purpose_wise.append({
            "purpose":     p.name,
            "collected":   collected,
            "target":      target,
            "progress_pct": round(collected / target * 100, 1) if target and target > 0 else None,
            "donor_count": len(pdonations),
        })
    purpose_wise.sort(key=lambda x: x["collected"], reverse=True)

    # ── Expense by category ────────────────────────────────────
    expense_by_cat: dict[str, float] = defaultdict(float)
    for e in all_expense_records:
        expense_by_cat[e.category or "Uncategorized"] += e.amount
    expense_category = sorted(
        [{"category": k, "total": round(v, 2)} for k, v in expense_by_cat.items()],
        key=lambda x: x["total"], reverse=True,
    )

    # ── Collector performance ──────────────────────────────────
    collectors = db.query(models.User).filter_by(role="collector", is_active=True).all()
    collector_perf = []
    for col in collectors:
        col_payments = db.query(models.PaymentEntry).filter(
            models.PaymentEntry.collected_by == col.name
        ).all()
        total_collected = round(sum(p.amount for p in col_payments if p.status == "verified"), 2)
        collector_perf.append({
            "name":            col.name,
            "payments_count":  len(col_payments),
            "total_collected": total_collected,
        })
    collector_perf.sort(key=lambda x: x["total_collected"], reverse=True)

    return {
        "top_donors":        top_donors,
        "monthly_trend":     monthly_trend,
        "yearly_trend":      yearly_trend,
        "purpose_wise":      purpose_wise,
        "expense_category":  expense_category,
        "collector_performance": collector_perf,
    }


@router.get("/receipt/{receipt_id}")
def get_receipt(
    receipt_id: str,
    db: Session = Depends(get_db),
):
    """
    Public receipt lookup — no auth required so QR code links work.
    Returns receipt info for display and verification.
    """
    # Try chanda payment (new PAY- prefix and legacy MM-CH- prefix)
    if receipt_id.startswith("PAY-") or receipt_id.startswith("MM-CH-"):
        rec = db.query(models.PaymentEntry).filter_by(receipt_id=receipt_id).first()
        if rec:
            head = db.query(models.ApprovedHead).filter_by(id=rec.head_id).first()
            months = sorted(rec.covered_months or [])
            collected_month = india_month_key(rec.collected_at) if rec.collected_at else None
            is_advance = bool(collected_month and months and months[-1] > collected_month)
            def _full_month(mk: str) -> str:
                import calendar as _cal
                y, m = mk.split("-")
                return f"{_cal.month_name[int(m)]} {y}"
            return {
                "type":                   "chanda",
                "receipt_id":             receipt_id,
                "name":                   head.name if head else None,
                "chanda_no":              head.chanda_no if head else None,
                # Home address deliberately omitted. This endpoint is
                # unauthenticated so QR receipt links work, and receipt ids are
                # sequential (MM-CH-YYYYMM-000001), so anyone could walk the
                # range and harvest every member's address. Name, amount and
                # months are enough to verify a receipt.
                "amount":                 rec.amount,
                "gross_amount":           rec.gross_amount or rec.amount,
                "discount_amount":        rec.discount_amount or 0,
                "method":                 rec.method,
                "monthly_rate":           rec.monthly_rate_snapshot,
                "covered_months":         months,
                "covered_months_display": [_full_month(m) for m in months],
                "months_count":           len(months),
                "is_advance":             is_advance,
                "collected_by":           rec.collected_by,
                "date":                   rec.created_at,
                "collected_at":           rec.collected_at,
                "status":                 rec.status,
            }

    # Try donation (new DON- prefix and legacy MM-DN- prefix)
    if receipt_id.startswith("DON-") or receipt_id.startswith("MM-DN-"):
        rec = db.query(models.Donation).filter_by(receipt_id=receipt_id).first()
        if rec:
            return {
                "type":        "donation",
                "receipt_id":  receipt_id,
                "name":        rec.donor_name,
                "amount":      rec.amount,
                "method":      rec.method,
                "purpose":     rec.purpose_rel.name if rec.purpose_rel else None,
                "fund_name":   rec.fund_rel.name if rec.fund_rel else None,
                "recorded_by": rec.recorded_by,
                "date":        rec.created_at,
            }

    # Try expense (new EXP- prefix and legacy MM-EX- prefix)
    if receipt_id.startswith("EXP-") or receipt_id.startswith("MM-EX-"):
        rec = db.query(models.Expense).filter_by(receipt_id=receipt_id).first()
        if rec:
            return {
                "type":        "expense",
                "receipt_id":  receipt_id,
                "title":       rec.title,
                "amount":      rec.amount,
                "category":    rec.category,
                "category_name": rec.category_rel.name if rec.category_rel else None,
                "fund_name":   rec.fund_rel.name if rec.fund_rel else None,
                "created_by":  rec.created_by,
                "approved_by": rec.approved_by,
                "date":        rec.created_at,
            }

    raise HTTPException(404, f"Receipt {receipt_id} not found")


@router.get("/notifications")
def get_notifications(
    current_user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Unified notification feed for the admin bell:
    - pending_verification: user-submitted chanda payments awaiting admin verify
    - recent_collection: collector/admin payments from the last 24 h
    - expense_approval: expenses with no approved_at (pending approval)

    Same-user expense blocking is enforced at the approve endpoint.
    """
    from sqlalchemy.orm import joinedload

    current_user_id = int(current_user["sub"])
    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)

    results = []

    # ── 1. Pending user-payment verifications ──────────────────
    pending_payments = (
        db.query(models.PaymentEntry)
        .options(
            joinedload(models.PaymentEntry.head),
            joinedload(models.PaymentEntry.paid_by_user),
        )
        .filter(
            models.PaymentEntry.status == "pending",
            models.PaymentEntry.created_by == "user",
        )
        .order_by(models.PaymentEntry.created_at.desc())
        .all()
    )
    for p in pending_payments:
        paid_by_name = None
        if p.paid_by_user:
            paid_by_name = p.paid_by_user.name
        elif p.collected_by:
            paid_by_name = p.collected_by
        results.append({
            "id": f"pay_{p.id}",
            "kind": "pending_verification",
            "ref_id": p.id,
            "title": p.head.name if p.head else (p.collected_by or "Unknown"),
            "subtitle": f"₹{p.amount:,.0f} · {(p.method or 'UPI').upper()}" + (f" by {paid_by_name}" if paid_by_name and paid_by_name != (p.head.name if p.head else None) else ""),
            "amount": float(p.amount),
            "method": p.method or "upi",
            "proof_image": p.proof_image,
            "transaction_ref": p.transaction_ref,
            "payer_name": p.head.name if p.head else p.collected_by,
            "paid_by_name": paid_by_name,
            "head_id": p.head_id,
            "covered_months": p.covered_months or [],
            "receipt_id": p.receipt_id,
            "created_at": p.created_at.isoformat() + "Z" if p.created_at else None,
            "actionable": True,
            "can_act": True,
        })

    # ── 2. Recent collections (last 24 h, verified, by collector/admin) ───
    recent = (
        db.query(models.PaymentEntry)
        .options(joinedload(models.PaymentEntry.head))
        .filter(
            models.PaymentEntry.created_at >= since_24h,
            models.PaymentEntry.status == "verified",
            models.PaymentEntry.created_by.in_(["collector", "admin"]),
        )
        .order_by(models.PaymentEntry.created_at.desc())
        .limit(10)
        .all()
    )
    for p in recent:
        results.append({
            "id": f"col_{p.id}",
            "kind": "recent_collection",
            "ref_id": p.id,
            "title": p.head.name if p.head else (p.collected_by or "Unknown"),
            "subtitle": f"₹{p.amount:,.0f} collected · {(p.method or 'cash').upper()}",
            "amount": float(p.amount),
            "method": p.method or "cash",
            "proof_image": None,
            "payer_name": p.head.name if p.head else p.collected_by,
            "paid_by_name": p.collected_by,
            "head_id": p.head_id,
            "covered_months": p.covered_months or [],
            "receipt_id": p.receipt_id,
            "created_at": p.created_at.isoformat() + "Z" if p.created_at else None,
            "actionable": False,
            "can_act": False,
        })

    # ── 3. Recent donations/fund contributions (last 24 h) ────
    # Donations have no verification workflow (collector/self-pay entries
    # are final on submit) — this is the only admin-side visibility they
    # had a right to and previously had none of.
    recent_donations = (
        db.query(models.Donation)
        .filter(models.Donation.created_at >= since_24h)
        .order_by(models.Donation.created_at.desc())
        .limit(10)
        .all()
    )
    for d in recent_donations:
        is_fund = d.fund_id is not None
        results.append({
            "id": f"don_{d.id}",
            "kind": "recent_donation",
            "ref_id": d.id,
            "title": d.donor_name,
            "subtitle": f"₹{d.amount:,.0f} · {'Fund' if is_fund else 'Donation'} · {(d.method or 'cash').upper()}",
            "amount": float(d.amount),
            "method": d.method or "cash",
            "proof_image": d.receipt_image,
            "payer_name": d.donor_name,
            "paid_by_name": d.recorded_by,
            "head_id": d.head_id,
            "covered_months": [],
            "receipt_id": d.receipt_id,
            "created_at": d.created_at.isoformat() + "Z" if d.created_at else None,
            "actionable": False,
            "can_act": False,
        })

    # ── 4. Expenses awaiting approval ─────────────────────────
    pending_expenses = (
        db.query(models.Expense)
        .filter(
            models.Expense.is_deleted == False,
            models.Expense.approved_at.is_(None),
        )
        .order_by(models.Expense.created_at.desc())
        .all()
    )
    for exp in pending_expenses:
        # Creator cannot approve their own expense
        can_act = (exp.created_by_id is None or exp.created_by_id != current_user_id)
        results.append({
            "id": f"exp_{exp.id}",
            "kind": "expense_approval",
            "ref_id": exp.id,
            "title": exp.title,
            "subtitle": f"₹{exp.amount:,.0f} · by {exp.created_by or 'Admin'}" + ("" if can_act else " · You created this"),
            "amount": float(exp.amount),
            "method": None,
            "proof_image": exp.receipt_image,
            "payer_name": exp.created_by,
            "paid_by_name": None,
            "head_id": None,
            "covered_months": [],
            "receipt_id": exp.receipt_id,
            "created_at": exp.created_at.isoformat() + "Z" if exp.created_at else None,
            "actionable": True,
            "can_act": can_act,
        })

    # ── 5. Pending rollback approvals ──────────────────────────
    pending_rollbacks = (
        db.query(models.PaymentRollbackRequest)
        .options(joinedload(models.PaymentRollbackRequest.payment_entry), joinedload(models.PaymentRollbackRequest.requested_by))
        .filter(models.PaymentRollbackRequest.status == "pending")
        .order_by(models.PaymentRollbackRequest.requested_at.desc())
        .all()
    )
    for req in pending_rollbacks:
        payment = req.payment_entry
        head = payment.head if payment else None
        results.append({
            "id": f"rollback_{req.id}",
            "kind": "rollback_approval",
            "ref_id": req.id,
            "title": head.name if head else (payment.receipt_id or "Rollback request"),
            "subtitle": f"{payment.receipt_id or 'Payment'} · ₹{float(payment.amount or 0):,.0f}" + (f" · {req.reason}" if req.reason else ""),
            "amount": float(payment.amount or 0),
            "method": payment.method or "cash",
            "proof_image": payment.proof_image,
            "payer_name": head.name if head else None,
            "paid_by_name": req.requested_by.name if req.requested_by else None,
            "head_id": payment.head_id if payment else None,
            "covered_months": payment.covered_months or [],
            "receipt_id": payment.receipt_id,
            "created_at": req.requested_at.isoformat() + "Z" if req.requested_at else None,
            "actionable": True,
            "can_act": True,
            "member_name": head.name if head else None,
            "chanda_no": head.chanda_no if head else None,
            "payment_source": payment.payment_source or "app",
            "requested_by": req.requested_by.name if req.requested_by else None,
            "reason": req.reason,
            "request_id": req.id,
            "payment_id": payment.id if payment else None,
        })

    # ── 6. Recent self-service account deletions (last 24 h) ─────
    # Informational only (nothing to action) — same shape as recent_collection/
    # recent_donation. Sourced from the audit trail rather than a new table,
    # since USER_ACCOUNT_DELETED is already logged there by /auth/delete-account.
    recent_deletions = (
        db.query(models.AuditLog)
        .filter(
            models.AuditLog.action == AuditAction.USER_ACCOUNT_DELETED,
            models.AuditLog.performed_at >= since_24h,
        )
        .order_by(models.AuditLog.performed_at.desc())
        .limit(10)
        .all()
    )
    for log in recent_deletions:
        new_values = log.new_values or {}
        user_name = new_values.get("user_name") or log.user_fullname or "A user"
        chanda_no = new_values.get("chanda_no")
        results.append({
            "id": f"del_{log.id}",
            "kind": "account_deletion",
            "ref_id": log.record_id,
            "title": user_name,
            "subtitle": "User requested account deletion" + (f" · Chanda No. {chanda_no}" if chanda_no else ""),
            "amount": 0.0,
            "method": None,
            "proof_image": None,
            "payer_name": user_name,
            "paid_by_name": None,
            "head_id": None,
            "covered_months": [],
            "receipt_id": None,
            "created_at": log.performed_at.isoformat() + "Z" if log.performed_at else None,
            "actionable": False,
            "can_act": False,
        })

    # Sort: pending_verification first, then expense_approval, then recent
    kind_order = {"pending_verification": 0, "expense_approval": 1, "rollback_approval": 1, "recent_collection": 2, "recent_donation": 2, "account_deletion": 2}
    results.sort(key=lambda x: (kind_order.get(x["kind"], 9), x.get("created_at") or ""))
    return results


@router.patch("/expenses/{expense_id}/approve-from-notif")
def approve_expense_from_notification(
    expense_id: int,
    current_user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Approve an expense from the notification bell. Blocks self-approval."""
    current_user_id = int(current_user["sub"])
    exp = db.query(models.Expense).filter_by(id=expense_id, is_deleted=False).first()
    if not exp:
        raise HTTPException(404, "Expense not found")
    if exp.approved_at:
        raise HTTPException(400, "Already approved")
    if exp.created_by_id and exp.created_by_id == current_user_id:
        raise HTTPException(403, "You cannot approve your own expense")

    u = db.query(models.User).filter_by(id=current_user_id).first()
    actor_name = u.name if u else "Admin"
    exp.approved_by = actor_name
    exp.approved_by_id = current_user_id
    exp.approved_at = datetime.utcnow()
    db.commit()

    manager.publish_sync("finance", "expense_approved", {
        "expense_id": exp.id, "approved_by": actor_name,
    })
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"ok": True, "expense_id": exp.id, "approved_by": actor_name}


@router.get("/collections")
def get_collections(
    page: int = 1,
    per_page: int = 50,
    created_by: Optional[str] = None,
    method: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Collection history — all verified payments with full details."""
    from sqlalchemy.orm import joinedload
    q = (
        db.query(models.PaymentEntry)
        .options(joinedload(models.PaymentEntry.head))
        .filter(models.PaymentEntry.status == "verified")
    )
    if created_by:
        q = q.filter(models.PaymentEntry.created_by == created_by)
    if method:
        q = q.filter(models.PaymentEntry.method == method)
    if from_date:
        try:
            q = q.filter(models.PaymentEntry.created_at >= datetime.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(models.PaymentEntry.created_at <= datetime.fromisoformat(to_date))
        except ValueError:
            pass
    total = q.count()
    entries = q.order_by(models.PaymentEntry.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "entries": [
            {
                "id": p.id,
                "receipt_id": p.receipt_id,
                "head_name": p.head.name if p.head else "Unknown",
                "head_id": p.head_id,
                "amount": float(p.amount),
                "method": p.method or "cash",
                "created_by": p.created_by,
                "collected_by": p.collected_by,
                "collected_at": p.collected_at.isoformat() + "Z" if p.collected_at else None,
                "verified_at": p.verified_at.isoformat() + "Z" if p.verified_at else None,
                "created_at": p.created_at.isoformat() + "Z" if p.created_at else None,
                "proof_image": p.proof_image,
                "transaction_ref": p.transaction_ref,
                "notes": p.notes,
                "covered_months": p.covered_months or [],
                "status": p.status,
            }
            for p in entries
        ],
    }


def _build_chanda_description(p, name: str) -> str:
    months = p.covered_months or []
    if not months:
        return f"Chanda — {name}"
    collected_month = india_month_key(p.collected_at) if p.collected_at else None
    is_advance = collected_month and months[-1] > collected_month
    if is_advance:
        def _fmt(mk: str) -> str:
            y, m = mk.split("-")
            import calendar
            return f"{calendar.month_abbr[int(m)]} {y}"
        span = f"{_fmt(months[0])}–{_fmt(months[-1])}" if len(months) > 1 else _fmt(months[0])
        return f"Advance Chanda — {name} — Covered {span}"
    if len(months) == 1:
        y, m = months[0].split("-")
        import calendar
        return f"Chanda — {name} — {calendar.month_abbr[int(m)]} {y}"
    return f"Chanda — {name} — {len(months)} months"


@router.get("/timeline")
def get_finance_timeline(
    page: int = 1,
    per_page: int = 50,
    type: Optional[str] = None,          # chanda | donation | expense | all (default)
    method: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    created_by: Optional[str] = None,    # "collector" | "user" | "admin"
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Unified Finance Timeline — chanda payments, donations, expenses in one feed.
    Each item has a `entry_type` field: "chanda" | "donation" | "expense".
    Sorted by transaction date descending.
    """
    from_dt = None
    to_dt   = None
    try:
        if from_date: from_dt = datetime.fromisoformat(from_date)
        if to_date:   to_dt   = datetime.fromisoformat(to_date)
    except ValueError:
        pass

    from sqlalchemy.orm import joinedload as _tl_jl

    items: list[dict] = []

    # ── Chanda payments (verified) ────────────────────────────────────────────
    if not type or type in ("chanda", "all"):
        q = (
            db.query(models.PaymentEntry)
            .options(_tl_jl(models.PaymentEntry.head))
            .filter(models.PaymentEntry.status == "verified")
        )
        if method:     q = q.filter(models.PaymentEntry.method == method)
        if from_dt:    q = q.filter(models.PaymentEntry.created_at >= from_dt)
        if to_dt:      q = q.filter(models.PaymentEntry.created_at <= to_dt)
        if created_by: q = q.filter(models.PaymentEntry.created_by == created_by)
        for p in q.all():
            name = p.head.name if p.head else (p.collected_by or "Unknown")
            if search and search.lower() not in (
                name + (p.receipt_id or "") + (p.collected_by or "") + (p.head.chanda_no if p.head else "")
            ).lower():
                continue
            items.append({
                "entry_type":    "chanda",
                "id":            p.id,
                "receipt_id":    p.receipt_id,
                "amount":        float(p.amount),
                "method":        p.method or "cash",
                "created_at":    p.created_at.isoformat() + "Z" if p.created_at else None,
                "created_by":    p.created_by,
                "head_name":     name,
                "head_id":       p.head_id,
                "chanda_no":     p.head.chanda_no if p.head else None,
                "collected_by":  p.collected_by,
                "collected_at":  p.collected_at.isoformat() + "Z" if p.collected_at else None,
                "proof_image":   p.proof_image,
                "transaction_ref": p.transaction_ref,
                "notes":         p.notes,
                "covered_months": p.covered_months or [],
                "months_covered": p.months_covered or 0,
                "monthly_rate_snapshot": p.monthly_rate_snapshot,
                "is_advance":    bool(p.covered_months and len(p.covered_months) > 0 and
                                      p.collected_at and
                                      (p.covered_months[-1] > india_month_key(p.collected_at)
                                       if p.covered_months else False)),
                "status":        p.status,
                "rollback_status": p.rollback_status,
                "payment_source": p.payment_source,
                "description":   _build_chanda_description(p, name),
            })

    # ── Donations ─────────────────────────────────────────────────────────────
    if not type or type in ("donation", "all"):
        q = (
            db.query(models.Donation)
            .options(_tl_jl(models.Donation.purpose_rel))
        )
        if method:  q = q.filter(models.Donation.method == method)
        if from_dt: q = q.filter(models.Donation.created_at >= from_dt)
        if to_dt:   q = q.filter(models.Donation.created_at <= to_dt)
        for d in q.all():
            if search and search.lower() not in (
                (d.donor_name or "") + (d.receipt_id or "") + (d.phone or "")
            ).lower():
                continue
            purpose_name = (d.purpose_rel.name if d.purpose_rel else None) or "—"
            items.append({
                "entry_type":    "donation",
                "id":            d.id,
                "receipt_id":    d.receipt_id,
                "amount":        float(d.amount or 0),
                "method":        d.method or "cash",
                "created_at":    d.created_at.isoformat() + "Z" if d.created_at else None,
                "created_by":    "admin",
                "head_name":     d.donor_name or "Unknown Donor",
                "head_id":       None,
                "chanda_no":     None,
                "collected_by":  None,
                "collected_at":  None,
                "proof_image":   d.receipt_image,
                "transaction_ref": None,
                "notes":         d.note,
                "covered_months": [],
                "status":        "verified",
                "description":   f"Donation — {d.donor_name or 'Unknown'}",
                "purpose":       purpose_name,
                "fund_id":       d.fund_id,
            })

    # ── Expenses (approved only) ───────────────────────────────────────────────
    if not type or type in ("expense", "all"):
        q = db.query(models.Expense).filter(
            models.Expense.is_deleted == False,
            models.Expense.approved_at.isnot(None),
        )
        if from_dt: q = q.filter(models.Expense.created_at >= from_dt)
        if to_dt:   q = q.filter(models.Expense.created_at <= to_dt)
        for e in q.all():
            if search and search.lower() not in (
                (e.title or "") + (e.receipt_id or "") + (e.created_by or "")
            ).lower():
                continue
            items.append({
                "entry_type":    "expense",
                "id":            e.id,
                "receipt_id":    e.receipt_id,
                "amount":        -float(e.amount or 0),  # negative = outflow
                "method":        None,
                "created_at":    e.created_at.isoformat() + "Z" if e.created_at else None,
                "created_by":    e.created_by or "admin",
                "head_name":     e.title or "Expense",
                "head_id":       None,
                "chanda_no":     None,
                "collected_by":  e.approved_by,
                "collected_at":  e.approved_at.isoformat() + "Z" if e.approved_at else None,
                "proof_image":   e.receipt_image,
                "transaction_ref": None,
                "notes":         e.note,
                "covered_months": [],
                "status":        "approved",
                "description":   f"Expense — {e.title}",
                "category":      e.category,
                "fund_id":       e.fund_id,
            })

    # ── Cash Submissions (approved only) ─────────────────────────────────────
    if not type or type in ("cash_submission", "all"):
        from sqlalchemy.orm import joinedload as _cs_jl
        q = (
            db.query(models.CollectorCashSubmission)
            .options(
                _cs_jl(models.CollectorCashSubmission.collector),
                _cs_jl(models.CollectorCashSubmission.receiving_admin),
            )
            .filter(models.CollectorCashSubmission.status == "approved")
        )
        if from_dt: q = q.filter(models.CollectorCashSubmission.submitted_at >= from_dt)
        if to_dt:   q = q.filter(models.CollectorCashSubmission.submitted_at <= to_dt)
        for cs in q.all():
            collector_name = cs.collector.name if cs.collector else "Unknown Collector"
            admin_name = cs.receiving_admin.name if cs.receiving_admin else None
            if search and search.lower() not in (collector_name + (admin_name or "")).lower():
                continue
            desc = f"Cash Submission — {collector_name}"
            if admin_name:
                desc += f" → {admin_name}"
            items.append({
                "entry_type":    "cash_submission",
                "id":            cs.id,
                "receipt_id":    None,
                "amount":        float(cs.approved_amount or cs.submitted_amount),
                "method":        "cash",
                "created_at":    cs.approved_at.isoformat() + "Z" if cs.approved_at else (cs.submitted_at.isoformat() + "Z" if cs.submitted_at else None),
                "created_by":    "collector",
                "head_name":     collector_name,
                "head_id":       None,
                "chanda_no":     None,
                "collected_by":  admin_name,
                "collected_at":  cs.approved_at.isoformat() + "Z" if cs.approved_at else None,
                "proof_image":   None,
                "transaction_ref": None,
                "notes":         cs.notes,
                "covered_months": [],
                "status":        cs.status,
                "description":   desc,
                "submitted_amount": float(cs.submitted_amount),
                "start_date":    cs.start_date.isoformat() + "Z" if cs.start_date else None,
                "end_date":      cs.end_date.isoformat() + "Z" if cs.end_date else None,
            })

    # Newest first — but a transaction dated in the future has not happened yet,
    # so it must not outrank one that has.
    #
    # The Excel migration stamps each imported payment with created_at = the
    # month it covers (admin.py, historical import). Importing paid-up-to-
    # December while the current month is August therefore writes rows dated
    # months ahead, and a collection recorded today sorted *below* every one of
    # them — the collector's payment was in the database and simply never
    # appeared near the top of the Finance Timeline.
    #
    # Two tiers: everything up to now, newest first; then future-dated rows
    # after them. Advance payments taken through the app are unaffected — their
    # created_at is the moment they were recorded, and only covered_months
    # points at a future month.
    now_iso = utc_now_naive().isoformat() + "Z"

    def _sort_key(x):
        ts = x.get("created_at") or ""
        return (0 if ts > now_iso else 1, ts)

    items.sort(key=_sort_key, reverse=True)
    total = len(items)
    start = (page - 1) * per_page
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "entries": items[start : start + per_page],
    }


@router.get("/collector/history")
def get_collector_history(
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """
    Returns the calling collector's own collection history — chanda payments
    AND donations/fund contributions they recorded — newest first, paginated.
    Only returns records attributed to the logged-in collector's name.
    """
    collector_name = current_user.get("name") or current_user.get("username", "")

    payments = (
        db.query(models.PaymentEntry)
        .filter(models.PaymentEntry.collected_by == collector_name)
        .all()
    )

    donations = (
        db.query(models.Donation)
        .filter(models.Donation.recorded_by == collector_name)
        .all()
    )

    items = []
    for p in payments:
        head = p.head
        name = head.name if head else (p.collected_by or "Unknown")
        collected_month = india_month_key(p.collected_at) if p.collected_at else None
        months = sorted(p.covered_months or [])
        is_advance = bool(
            collected_month and months and months[-1] > collected_month
        )
        items.append({
            "id":                     p.id,
            "entry_type":             "chanda",
            "receipt_id":             p.receipt_id,
            "amount":                 float(p.amount),
            "method":                 p.method or "cash",
            "status":                 p.status,
            "created_at":             p.created_at.isoformat() + "Z" if p.created_at else None,
            "collected_at":           p.collected_at.isoformat() + "Z" if p.collected_at else None,
            "verified_at":            p.verified_at.isoformat() + "Z" if p.verified_at else None,
            "head_name":              name,
            "head_id":                p.head_id,
            "chanda_no":              head.chanda_no if head else None,
            "address":                head.address if head else None,
            "phone":                  head.phone if head else None,
            "collected_by":           p.collected_by,
            "transaction_ref":        p.transaction_ref,
            "notes":                  p.notes,
            "covered_months":         months,
            "months_covered":         p.months_covered or len(months),
            "monthly_rate_snapshot":  p.monthly_rate_snapshot,
            "gross_amount":           p.gross_amount or p.amount,
            "discount_amount":        p.discount_amount or 0,
            "is_advance":             is_advance,
            "proof_image":            p.proof_image,
            "purpose":                "Monthly Chanda",
        })

    for d in donations:
        is_fund = d.fund_id is not None
        items.append({
            "id":                     d.id,
            "entry_type":             "fund" if is_fund else "donation",
            "receipt_id":             d.receipt_id,
            "amount":                 float(d.amount),
            "method":                 d.method or "cash",
            "status":                 "verified",  # collector-recorded donations have no verification workflow
            "created_at":             d.created_at.isoformat() + "Z" if d.created_at else None,
            "collected_at":           d.donation_date.isoformat() + "Z" if d.donation_date else (d.created_at.isoformat() + "Z" if d.created_at else None),
            "verified_at":            None,
            "head_name":              d.donor_name,
            "head_id":                d.head_id,
            "chanda_no":              d.chanda_no,
            "address":                None,
            "phone":                  d.phone,
            "collected_by":           d.recorded_by,
            "transaction_ref":        None,
            "notes":                  d.note,
            "covered_months":         [],
            "months_covered":         0,
            "monthly_rate_snapshot":  None,
            "gross_amount":           float(d.amount),
            "discount_amount":        0,
            "is_advance":             False,
            "proof_image":            d.receipt_image,
            "purpose":                "Fund" if is_fund else "Donation",
        })

    items.sort(key=lambda x: x["collected_at"] or x["created_at"] or "", reverse=True)

    total = len(items)
    start = (page - 1) * per_page
    page_items = items[start: start + per_page]

    # Today summary — use IST date so early-morning (pre-5:30 AM UTC) payments aren't missed
    today_ist = to_india(utc_now()).strftime("%Y-%m-%d")

    def _ist_date(iso_str: str | None) -> str:
        if not iso_str:
            return ""
        try:
            from datetime import timezone
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return to_india(dt).strftime("%Y-%m-%d")
        except Exception:
            return iso_str[:10]

    today_items = [
        p for p in items
        if _ist_date(p["collected_at"] or p["created_at"]) == today_ist
    ]
    chanda_items   = [p for p in items if p["entry_type"] == "chanda"]
    donation_items = [p for p in items if p["entry_type"] == "donation"]
    fund_items     = [p for p in items if p["entry_type"] == "fund"]

    today_total   = round(sum(p["amount"] for p in today_items), 2)
    today_cash    = round(sum(p["amount"] for p in today_items if p["method"] == "cash"), 2)
    today_upi     = round(sum(p["amount"] for p in today_items if p["method"] != "cash"), 2)
    today_advance = sum(1 for p in today_items if p["is_advance"])

    # Per-day breakdown (IST calendar day), most recent first — powers the
    # collector dashboard's "per day collection" view.
    daily_buckets: dict[str, dict] = {}
    for it in items:
        day = _ist_date(it["collected_at"] or it["created_at"])
        if not day:
            continue
        bucket = daily_buckets.setdefault(day, {"date": day, "cash": 0.0, "online": 0.0, "total": 0.0, "count": 0})
        amt = it["amount"]
        if it["method"] == "cash":
            bucket["cash"] = round(bucket["cash"] + amt, 2)
        else:
            bucket["online"] = round(bucket["online"] + amt, 2)
        bucket["total"] = round(bucket["total"] + amt, 2)
        bucket["count"] += 1
    daily = sorted(daily_buckets.values(), key=lambda b: b["date"], reverse=True)

    return {
        "total":      total,
        "page":       page,
        "per_page":   per_page,
        "entries":    page_items,
        "today": {
            "total":    today_total,
            "cash":     today_cash,
            "upi":      today_upi,
            "count":    len(today_items),
            "advance":  today_advance,
        },
        "stats": {
            "monthly_chanda_total": round(sum(p["amount"] for p in chanda_items), 2),
            "donations_total":      round(sum(p["amount"] for p in donation_items), 2),
            "funds_total":          round(sum(p["amount"] for p in fund_items), 2),
            "total_collection":     round(sum(p["amount"] for p in items), 2),
            "pending_count":        sum(1 for p in chanda_items if p["status"] == "pending"),
            "today_total":          today_total,
        },
        "daily": daily,
    }


@router.post("/jobs/run/{job_name}")
def run_job_manually(
    job_name: str,
    current_user: dict = Depends(require_superadmin),
):
    """Manually trigger a scheduled job. Useful for testing and emergency runs."""
    from app.scheduler import (
        job_generate_chanda_month, job_send_reminder_sms,
        job_process_sms_queue, job_session_cleanup, job_audit_cleanup,
    )
    jobs = {
        "generate_chanda_month": job_generate_chanda_month,
        "send_reminder_sms":     job_send_reminder_sms,
        "process_sms_queue":     job_process_sms_queue,
        "session_cleanup":       job_session_cleanup,
        "audit_cleanup":         job_audit_cleanup,
    }
    fn = jobs.get(job_name)
    if not fn:
        raise HTTPException(404, f"Unknown job '{job_name}'. Available: {sorted(jobs)}")
    try:
        fn()
        return {"message": f"Job '{job_name}' completed"}
    except Exception as e:
        raise HTTPException(500, f"Job '{job_name}' failed: {e}")


def write_audit(
    db: Session,
    table_name: str,
    record_id: int,
    action: str,
    *,
    old_values: dict = None,
    new_values: dict = None,
    performed_by_id: int = None,
    ip_address: str = None,
    note: str = None,
    # Enhanced enterprise fields
    module: str = None,
    action_label: str = None,
    user_role: str = None,
    user_fullname: str = None,
    description: str = None,
    browser: str = None,
    os_name: str = None,
    device_name: str = None,
    session_id: int = None,
    request_id: str = None,
    endpoint: str = None,
    http_method: str = None,
    status: str = "success",
    failure_reason: str = None,
    execution_time_ms: int = None,
    affected_record_type: str = None,
) -> models.AuditLog:
    entry = models.AuditLog(
        table_name=table_name,
        record_id=record_id,
        action=action,
        old_values=old_values,
        new_values=new_values,
        performed_by_id=performed_by_id,
        performed_at=datetime.utcnow(),
        ip_address=ip_address,
        note=note,
        module=module,
        action_label=action_label,
        user_role=user_role,
        user_fullname=user_fullname,
        description=description,
        browser=browser,
        os_name=os_name,
        device_name=device_name,
        session_id=session_id,
        request_id=request_id,
        endpoint=endpoint,
        http_method=http_method,
        status=status,
        failure_reason=failure_reason,
        execution_time_ms=execution_time_ms,
        affected_record_type=affected_record_type,
    )
    db.add(entry)
    return entry
