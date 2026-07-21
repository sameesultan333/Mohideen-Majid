"""
Enterprise Expenses Module — Mohideen Masjid
Covers: categories, CRUD, search, filter, sort, paginate,
        stats, monthly summary, category summary, dashboard,
        PDF/Excel/CSV reports, soft-delete, receipt mgmt,
        audit logs, ledger entries, WebSocket events.
"""
from __future__ import annotations

import io
import math
import calendar
from datetime import datetime, date, timedelta
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, and_, case
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import SessionLocal
from app.security import require_admin, require_superadmin
from app.websocket_manager import manager
from app.routes.finance import write_audit, write_ledger, _sanitize, invalidate_dashboard_cache, invalidate_dashboard_cache
from app.utils.payment_ledger import generate_receipt_id

router = APIRouter(prefix="/expenses", tags=["Expenses"])


# ─────────────────────────────────────────────────────────────
# DB / helpers
# ─────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _actor(user: dict, db: Session) -> tuple[int, str]:
    uid = int(user["sub"])
    u = db.query(models.User).filter_by(id=uid).first()
    return uid, (u.name if u else "Admin")


def _get_expense(db: Session, expense_id: int) -> models.Expense:
    exp = (
        db.query(models.Expense)
        .options(
            joinedload(models.Expense.category_rel),
            joinedload(models.Expense.fund_rel),
        )
        .filter_by(id=expense_id, is_deleted=False)
        .first()
    )
    if not exp:
        raise HTTPException(404, "Expense not found")
    return exp


def _enrich(exp: models.Expense) -> dict:
    """Return dict with resolved category_name for response."""
    d = {c.name: getattr(exp, c.name) for c in exp.__table__.columns}
    d["category_name"] = exp.category_rel.name if exp.category_rel else exp.category
    return d


def _base_query(db: Session):
    return (
        db.query(models.Expense)
        .options(
            joinedload(models.Expense.category_rel),
            joinedload(models.Expense.fund_rel),
        )
        .filter(models.Expense.is_deleted == False)
    )


def _validate_fund_for_expense(db: Session, fund_id: int) -> None:
    fund = db.query(models.Fund).filter_by(id=fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    if fund.is_archived or fund.status == "archived":
        raise HTTPException(400, "Cannot assign expenses to an archived or completed fund")


def _apply_filters(q, *, search, category_id, approved, created_by,
                   month, year, from_date, to_date, min_amount, max_amount):
    if search:
        term = f"%{search}%"
        q = q.filter(or_(
            models.Expense.title.ilike(term),
            models.Expense.receipt_id.ilike(term),
            models.Expense.note.ilike(term),
            models.Expense.created_by.ilike(term),
            models.Expense.approved_by.ilike(term),
        ))
    if category_id is not None:
        q = q.filter(models.Expense.category_id == category_id)
    if approved is not None:
        if approved:
            q = q.filter(models.Expense.approved_at.isnot(None))
        else:
            q = q.filter(models.Expense.approved_at.is_(None))
    if created_by:
        q = q.filter(models.Expense.created_by.ilike(f"%{created_by}%"))
    if month:
        q = q.filter(func.extract("month", models.Expense.created_at) == month)
    if year:
        q = q.filter(func.extract("year", models.Expense.created_at) == year)
    if from_date:
        q = q.filter(models.Expense.created_at >= from_date)
    if to_date:
        q = q.filter(models.Expense.created_at <= to_date)
    if min_amount is not None:
        q = q.filter(models.Expense.amount >= min_amount)
    if max_amount is not None:
        q = q.filter(models.Expense.amount <= max_amount)
    return q


def _apply_sort(q, sort_by: str, sort_order: str):
    col_map = {
        "created_at": models.Expense.created_at,
        "amount":     models.Expense.amount,
        "title":      models.Expense.title,
    }
    col = col_map.get(sort_by, models.Expense.created_at)
    return q.order_by(col.asc() if sort_order == "asc" else col.desc())


def _build_expense_out(exp: models.Expense) -> schemas.ExpenseOut:
    return schemas.ExpenseOut(
        id=exp.id,
        title=exp.title,
        amount=exp.amount,
        category=exp.category,
        category_id=exp.category_id,
        category_name=exp.category_rel.name if exp.category_rel else exp.category,
        fund_id=exp.fund_id,
        fund_name=exp.fund_rel.name if exp.fund_rel else None,
        vendor_name=exp.vendor_name,
        expense_date=exp.expense_date,
        note=exp.note,
        receipt_image=exp.receipt_image,
        receipt_id=exp.receipt_id,
        created_by=exp.created_by,
        created_by_id=exp.created_by_id,
        approved_by=exp.approved_by,
        approved_by_id=exp.approved_by_id,
        approved_at=exp.approved_at,
        created_at=exp.created_at,
        is_deleted=exp.is_deleted,
    )


# ─────────────────────────────────────────────────────────────
# EXPENSE CATEGORIES
# ─────────────────────────────────────────────────────────────

@router.get(
    "/categories",
    response_model=List[schemas.ExpenseCategoryOut],
    summary="List expense categories",
)
def list_categories(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    q = db.query(models.ExpenseCategory)
    if not include_inactive:
        q = q.filter_by(is_active=True)
    return q.order_by(models.ExpenseCategory.name).all()


@router.post(
    "/categories",
    response_model=schemas.ExpenseCategoryOut,
    status_code=201,
    summary="Create expense category",
)
def create_category(
    data: schemas.ExpenseCategoryCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    if db.query(models.ExpenseCategory).filter_by(name=data.name).first():
        raise HTTPException(400, f"Category '{data.name}' already exists")
    cat = models.ExpenseCategory(
        name=data.name.strip(),
        description=data.description,
        is_active=data.is_active,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    actor_id, _ = _actor(user, db)
    write_audit(db, "expense_categories", cat.id, "create",
                new_values={"name": cat.name}, performed_by_id=actor_id)
    db.commit()
    return cat


@router.put(
    "/categories/{cat_id}",
    response_model=schemas.ExpenseCategoryOut,
    summary="Update expense category",
)
def update_category(
    cat_id: int,
    data: schemas.ExpenseCategoryUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    cat = db.query(models.ExpenseCategory).filter_by(id=cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    old = {"name": cat.name, "is_active": cat.is_active}
    if data.name is not None:
        # check uniqueness
        dup = db.query(models.ExpenseCategory).filter(
            models.ExpenseCategory.name == data.name.strip(),
            models.ExpenseCategory.id != cat_id,
        ).first()
        if dup:
            raise HTTPException(400, f"Category '{data.name}' already exists")
        cat.name = data.name.strip()
    if data.description is not None:
        cat.description = data.description
    if data.is_active is not None:
        cat.is_active = data.is_active
    actor_id, _ = _actor(user, db)
    write_audit(db, "expense_categories", cat.id, "update",
                old_values=old, new_values={"name": cat.name, "is_active": cat.is_active},
                performed_by_id=actor_id)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch(
    "/categories/{cat_id}/status",
    response_model=schemas.ExpenseCategoryOut,
    summary="Toggle category active/inactive",
)
def toggle_category_status(
    cat_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    cat = db.query(models.ExpenseCategory).filter_by(id=cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.is_active = not cat.is_active
    actor_id, _ = _actor(user, db)
    write_audit(db, "expense_categories", cat.id, "update",
                new_values={"is_active": cat.is_active}, performed_by_id=actor_id)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete(
    "/categories/{cat_id}",
    summary="Delete expense category (superadmin only)",
)
def delete_category(
    cat_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_superadmin),
):
    cat = db.query(models.ExpenseCategory).filter_by(id=cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    in_use = db.query(models.Expense).filter_by(category_id=cat_id, is_deleted=False).count()
    if in_use:
        raise HTTPException(400, f"Cannot delete: {in_use} active expense(s) use this category")
    actor_id, _ = _actor(user, db)
    write_audit(db, "expense_categories", cat.id, "delete",
                old_values={"name": cat.name}, performed_by_id=actor_id)
    db.delete(cat)
    db.commit()
    return {"message": "Category deleted"}


# ─────────────────────────────────────────────────────────────
# STATISTICS (must be before /{expense_id} routes)
# ─────────────────────────────────────────────────────────────

@router.get(
    "/stats",
    response_model=schemas.ExpenseStats,
    summary="Expense statistics",
)
def expense_stats(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # previous month boundaries
    first_day_this = month_start
    last_month_end = first_day_this - timedelta(seconds=1)
    last_month_start = last_month_end.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )

    base = db.query(models.Expense).filter(models.Expense.is_deleted == False)

    total_expenses = base.count()
    total_amount   = base.with_entities(func.coalesce(func.sum(models.Expense.amount), 0.0)).scalar() or 0.0
    this_month     = base.filter(models.Expense.created_at >= month_start)
    this_month_amt = this_month.with_entities(func.coalesce(func.sum(models.Expense.amount), 0.0)).scalar() or 0.0
    this_month_cnt = this_month.count()
    today_amt      = base.filter(models.Expense.created_at >= today_start)\
                         .with_entities(func.coalesce(func.sum(models.Expense.amount), 0.0)).scalar() or 0.0
    pending        = base.filter(models.Expense.approved_at.is_(None)).count()
    approved       = base.filter(models.Expense.approved_at.isnot(None)).count()

    agg = base.with_entities(
        func.avg(models.Expense.amount),
        func.max(models.Expense.amount),
        func.min(models.Expense.amount),
    ).one()
    avg_exp, max_exp, min_exp = agg

    prev_cnt = base.filter(
        models.Expense.created_at >= last_month_start,
        models.Expense.created_at < first_day_this,
    ).count()

    growth = None
    if prev_cnt > 0:
        growth = round(((this_month_cnt - prev_cnt) / prev_cnt) * 100, 2)
    elif this_month_cnt > 0:
        growth = 100.0

    return _sanitize({
        "total_expenses":       total_expenses,
        "total_amount":         total_amount,
        "this_month_amount":    this_month_amt,
        "today_amount":         today_amt,
        "pending_approval":     pending,
        "approved":             approved,
        "average_expense":      round(float(avg_exp), 2) if avg_exp else None,
        "highest_expense":      float(max_exp) if max_exp else None,
        "lowest_expense":       float(min_exp) if min_exp else None,
        "current_month_count":  this_month_cnt,
        "previous_month_count": prev_cnt,
        "monthly_growth_pct":   growth,
    })


@router.get(
    "/monthly-summary",
    response_model=List[schemas.MonthlySummaryItem],
    summary="Last 12 months expense totals for charts",
)
def monthly_summary(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    now = datetime.utcnow()
    result = []
    for i in range(11, -1, -1):
        month_index = now.month - i
        year = now.year + (month_index - 1) // 12
        month = ((month_index - 1) % 12) + 1
        start = datetime(year, month, 1)
        end = datetime(year, month, calendar.monthrange(year, month)[1], 23, 59, 59)

        row = (
            db.query(
                func.count(models.Expense.id),
                func.coalesce(func.sum(models.Expense.amount), 0.0),
            )
            .filter(
                models.Expense.is_deleted == False,
                models.Expense.created_at >= start,
                models.Expense.created_at <= end,
            )
            .one()
        )
        result.append({
            "month": f"{year}-{month:02d}",
            "month_name": f"{calendar.month_abbr[month]} {year}",
            "count": row[0],
            "total_amount": float(row[1]),
        })
    return result


@router.get(
    "/category-summary",
    response_model=List[schemas.CategorySummaryItem],
    summary="Per-category expense totals for pie charts",
)
def category_summary(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    rows = (
        db.query(
            models.Expense.category_id,
            func.count(models.Expense.id),
            func.coalesce(func.sum(models.Expense.amount), 0.0),
        )
        .filter(models.Expense.is_deleted == False)
        .group_by(models.Expense.category_id)
        .all()
    )
    grand_total = sum(float(r[2]) for r in rows) or 1.0
    result = []
    for cat_id, cnt, total in rows:
        cat = db.query(models.ExpenseCategory).filter_by(id=cat_id).first() if cat_id else None
        result.append({
            "category_id":   cat_id,
            "category_name": cat.name if cat else "Uncategorized",
            "count":         cnt,
            "total_amount":  float(total),
            "percentage":    round(float(total) / grand_total * 100, 2),
        })
    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


@router.get(
    "/recent",
    response_model=List[schemas.ExpenseOut],
    summary="Latest 10 expenses",
)
def recent_expenses(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    exps = (
        _base_query(db)
        .order_by(models.Expense.created_at.desc())
        .limit(10)
        .all()
    )
    return [_build_expense_out(e) for e in exps]


@router.get(
    "/dashboard",
    response_model=schemas.ExpenseDashboard,
    summary="All dashboard data in one request",
)
def expense_dashboard(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    stats     = expense_stats(db=db, user=user)
    recent    = recent_expenses(db=db, user=user)
    monthly   = monthly_summary(db=db, user=user)
    cat_chart = category_summary(db=db, user=user)
    pending   = db.query(models.Expense).filter(
        models.Expense.is_deleted == False,
        models.Expense.approved_at.is_(None),
    ).count()
    return {
        "stats":                  stats,
        "recent":                 recent,
        "monthly_chart":          monthly,
        "category_chart":         cat_chart,
        "pending_approval_count": pending,
    }


# ─────────────────────────────────────────────────────────────
# REPORTS  (PDF / Excel / CSV)
# ─────────────────────────────────────────────────────────────

@router.get("/report", summary="Export expense report (pdf | excel)")
def expense_report(
    fmt:         Literal["pdf", "excel"] = Query("pdf", alias="format"),
    month:       Optional[int]  = None,
    year:        Optional[int]  = None,
    from_date:   Optional[date] = None,
    to_date:     Optional[date] = None,
    category_id: Optional[int]  = None,
    approved:    Optional[bool] = None,
    search:      Optional[str]  = None,
    db:          Session = Depends(get_db),
    user=Depends(require_admin),
):
    q = _base_query(db)
    q = _apply_filters(
        q, search=search, category_id=category_id, approved=approved,
        created_by=None, month=month, year=year,
        from_date=datetime.combine(from_date, datetime.min.time()) if from_date else None,
        to_date=datetime.combine(to_date, datetime.max.time()) if to_date else None,
        min_amount=None, max_amount=None,
    )
    expenses = q.order_by(models.Expense.created_at.desc()).all()

    # ── filter description for header ────────────────────────
    filter_parts = []
    if month and year:  filter_parts.append(f"{calendar.month_name[month]} {year}")
    elif year:          filter_parts.append(str(year))
    if from_date:       filter_parts.append(f"From {from_date}")
    if to_date:         filter_parts.append(f"To {to_date}")
    if search:          filter_parts.append(f"Search: {search}")
    filters_str = ", ".join(filter_parts) if filter_parts else "All time"

    grand_total = sum(e.amount for e in expenses)

    # ── Excel ────────────────────────────────────────────────
    if fmt == "excel":
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise HTTPException(500, "openpyxl not installed — run: pip install openpyxl")

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Expenses"

        green  = "0F5C4C"
        gold   = "D4AF37"
        hdr_ft = Font(bold=True, color="FFFFFF", size=11)
        hdr_bg = PatternFill("solid", fgColor=green)
        tot_ft = Font(bold=True, size=11)
        tot_bg = PatternFill("solid", fgColor=gold)
        center = Alignment(horizontal="center", vertical="center")
        thin   = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )

        # Title rows
        ws.merge_cells("A1:I1")
        ws["A1"] = "Mohideen Masjid — Expense Report"
        ws["A1"].font = Font(bold=True, size=14, color=green)
        ws["A1"].alignment = center
        ws.merge_cells("A2:I2")
        ws["A2"] = f"Filters: {filters_str}   |   Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC"
        ws["A2"].font = Font(size=10, color="666666")
        ws["A2"].alignment = center
        ws.append([])

        headers = ["#", "Receipt ID", "Title", "Category", "Vendor", "Amount (₹)",
                   "Note", "Created By", "Approved By", "Date"]
        ws.append(headers)
        for cell in ws[4]:
            cell.font = hdr_ft
            cell.fill = hdr_bg
            cell.alignment = center
            cell.border = thin

        for i, e in enumerate(expenses, 1):
            cat_name = e.category_rel.name if e.category_rel else (e.category or "—")
            ws.append([
                i, e.receipt_id or "", e.title, cat_name, e.vendor_name or "",
                round(e.amount, 2), e.note or "",
                e.created_by or "", e.approved_by or "",
                e.created_at.strftime("%Y-%m-%d"),
            ])
            for cell in ws[ws.max_row]:
                cell.border = thin

        # Total row
        ws.append(["", "", "GRAND TOTAL", "", "", round(grand_total, 2), "", "", "", ""])
        for cell in ws[ws.max_row]:
            cell.font = tot_ft
            cell.fill = tot_bg
            cell.border = thin

        ws.column_dimensions["A"].width = 5
        ws.column_dimensions["B"].width = 14
        ws.column_dimensions["C"].width = 30
        ws.column_dimensions["D"].width = 18
        ws.column_dimensions["E"].width = 18
        ws.column_dimensions["F"].width = 14
        ws.column_dimensions["G"].width = 25
        ws.column_dimensions["H"].width = 16
        ws.column_dimensions["I"].width = 16
        ws.column_dimensions["J"].width = 12

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=expenses_report.xlsx"},
        )

    # ── PDF ──────────────────────────────────────────────────
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph,
            Spacer, HRFlowable,
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    except ImportError:
        raise HTTPException(500, "reportlab not installed — run: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=2*cm,
    )
    styles = getSampleStyleSheet()
    green_color = colors.HexColor("#0F5C4C")
    gold_color  = colors.HexColor("#D4AF37")

    title_style    = ParagraphStyle("Title", parent=styles["Heading1"],
                                    textColor=green_color, alignment=TA_CENTER, fontSize=16)
    subtitle_style = ParagraphStyle("Sub", parent=styles["Normal"],
                                    textColor=colors.grey, alignment=TA_CENTER, fontSize=9)
    footer_style   = ParagraphStyle("Footer", parent=styles["Normal"],
                                    textColor=colors.grey, alignment=TA_CENTER, fontSize=8)

    story = [
        Paragraph("Mohideen Masjid", title_style),
        Paragraph("Expense Report", ParagraphStyle("R", parent=styles["Heading2"],
                  textColor=green_color, alignment=TA_CENTER, fontSize=13)),
        Spacer(1, 4),
        Paragraph(f"Filters: {filters_str}", subtitle_style),
        Paragraph(f"Generated: {datetime.utcnow().strftime('%d %b %Y  %H:%M')} UTC  |  "
                  f"Total records: {len(expenses)}", subtitle_style),
        HRFlowable(width="100%", thickness=1, color=gold_color),
        Spacer(1, 8),
    ]

    # Table
    col_headers = ["#", "Receipt ID", "Title", "Category", "Vendor", "Amount (₹)", "Created By", "Date", "Status"]
    data = [col_headers]
    for i, e in enumerate(expenses, 1):
        cat_name = e.category_rel.name if e.category_rel else (e.category or "—")
        status   = "Approved" if e.approved_at else "Pending"
        data.append([
            str(i), e.receipt_id or "—", e.title[:30], cat_name, e.vendor_name or "—",
            f"₹{e.amount:,.2f}", e.created_by or "—",
            e.created_at.strftime("%d/%m/%Y"), status,
        ])
    data.append(["", "", "GRAND TOTAL", "", "", f"₹{grand_total:,.2f}", "", "", ""])

    col_widths = [1*cm, 2.8*cm, 5.5*cm, 3*cm, 3*cm, 2.8*cm, 3*cm, 2.2*cm, 2*cm]
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0),  green_color),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",     (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0),  8),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("ALIGN",        (2, 1), (2, -2),  "LEFT"),
        ("FONTSIZE",     (0, 1), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F0F7F4")]),
        ("GRID",         (0, 0), (-1, -1), 0.4, colors.HexColor("#CCCCCC")),
        ("BACKGROUND",   (0, -1), (-1, -1), gold_color),
        ("FONTNAME",     (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",     (0, -1), (-1, -1), 9),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 12))

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.grey)
        canvas.drawString(1.5*cm, 1.2*cm,
                          f"Generated by Mohideen Masjid Management System  •  {datetime.utcnow().strftime('%d %b %Y')}")
        canvas.drawRightString(A4[0] - 1.5*cm, 1.2*cm,
                               f"Page {doc.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=expenses_report.pdf"},
    )


# ─────────────────────────────────────────────────────────────
# EXPENSE CRUD
# ─────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=schemas.ExpenseOut,
    status_code=201,
    summary="Create expense",
)
def add_expense(
    data: schemas.ExpenseCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    if data.amount is None or data.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(400, "Title is required")
    if len(title) > 255:
        raise HTTPException(400, "Title must be under 255 characters")

    if data.category_id is not None:
        cat = db.query(models.ExpenseCategory).filter_by(id=data.category_id, is_active=True).first()
        if not cat:
            raise HTTPException(400, "Invalid or inactive category")

    if data.fund_id is not None:
        fund = db.query(models.Fund).filter_by(id=data.fund_id, is_archived=False).first()
        if not fund:
            raise HTTPException(404, "Fund not found or archived")
        if fund.status == "archived":
            raise HTTPException(400, "Cannot use archived or completed funds for new expenses")

    actor_id, actor_name = _actor(user, db)
    dup = (
        db.query(models.Expense)
        .filter(
            models.Expense.is_deleted == False,
            models.Expense.title == title,
            models.Expense.amount == data.amount,
            models.Expense.category_id == data.category_id,
            models.Expense.created_at >= datetime.utcnow() - timedelta(minutes=5),
        )
        .first()
    )
    if dup:
        raise HTTPException(409, "A similar expense was created recently")

    exp = models.Expense(
        title=title,
        amount=data.amount,
        category=(data.category or "").strip() or None,
        category_id=data.category_id,
        fund_id=data.fund_id,
        vendor_name=(data.vendor_name or "").strip() or None,
        expense_date=data.expense_date,
        note=(data.note or "").strip() or None,
        receipt_image=data.receipt_image,
        receipt_id=generate_receipt_id(db, "EX"),
        created_by=actor_name,
        created_by_id=actor_id,
        created_at=datetime.utcnow(),
    )
    db.add(exp)
    db.flush()

    write_audit(
        db, "expenses", exp.id, "create",
        new_values={"title": data.title, "amount": data.amount,
                    "category_id": data.category_id, "category": data.category},
        performed_by_id=actor_id,
    )
    db.commit()

    # reload with all joins
    exp = db.query(models.Expense).options(
        joinedload(models.Expense.category_rel),
        joinedload(models.Expense.fund_rel),
    ).filter_by(id=exp.id).first()

    invalidate_dashboard_cache()
    manager.publish_sync("finance", "expense_created", {
        "expense_id": exp.id, "amount": exp.amount, "title": exp.title,
    })
    manager.publish_sync("finance", "dashboard_updated", {})
    return _build_expense_out(exp)


@router.get(
    "/",
    response_model=schemas.ExpensePage,
    summary="List expenses with search, filter, sort and pagination",
)
def get_expenses(
    search:      Optional[str]  = None,
    category_id: Optional[int]  = None,
    approved:    Optional[bool] = None,
    created_by:  Optional[str]  = None,
    month:       Optional[int]  = None,
    year:        Optional[int]  = None,
    from_date:   Optional[date] = None,
    to_date:     Optional[date] = None,
    min_amount:  Optional[float] = None,
    max_amount:  Optional[float] = None,
    sort_by:     str = Query("created_at", enum=["created_at", "amount", "title"]),
    sort_order:  str = Query("desc", enum=["asc", "desc"]),
    page:        int = Query(1, ge=1),
    page_size:   int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    q = _base_query(db)
    q = _apply_filters(
        q, search=search, category_id=category_id, approved=approved,
        created_by=created_by, month=month, year=year,
        from_date=datetime.combine(from_date, datetime.min.time()) if from_date else None,
        to_date=datetime.combine(to_date, datetime.max.time()) if to_date else None,
        min_amount=min_amount, max_amount=max_amount,
    )
    total = q.count()
    q     = _apply_sort(q, sort_by, sort_order)
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items":       [_build_expense_out(e) for e in items],
        "total":       total,
        "page":        page,
        "page_size":   page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@router.get(
    "/{expense_id}",
    response_model=schemas.ExpenseOut,
    summary="Get single expense",
)
def get_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    return _build_expense_out(_get_expense(db, expense_id))


@router.put(
    "/{expense_id}",
    response_model=schemas.ExpenseOut,
    summary="Update expense",
)
def update_expense(
    expense_id: int,
    data: schemas.ExpenseUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    exp = _get_expense(db, expense_id)
    actor_id, _ = _actor(user, db)

    old = {"title": exp.title, "amount": exp.amount,
           "category": exp.category, "category_id": exp.category_id}

    if exp.approved_at and not (data.force or user.get("role") == "superadmin"):
        if data.amount is not None or data.category_id is not None or data.category is not None or data.fund_id is not None:
            raise HTTPException(400, "Approved expenses can only change receipt metadata unless overridden")

    if data.amount is not None and data.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    if data.title is not None and len(data.title.strip()) > 255:
        raise HTTPException(400, "Title must be under 255 characters")

    if data.category_id is not None:
        cat = db.query(models.ExpenseCategory).filter_by(
            id=data.category_id, is_active=True
        ).first()
        if not cat:
            raise HTTPException(400, "Invalid or inactive category")

    if data.fund_id is not None:
        fund = db.query(models.Fund).filter_by(id=data.fund_id, is_archived=False).first()
        if not fund:
            raise HTTPException(404, "Fund not found or archived")
        if fund.status == "archived":
            raise HTTPException(400, "Cannot use archived or completed funds for expense updates")

    amount_changed = data.amount is not None and data.amount != exp.amount
    old_amount     = exp.amount

    if data.title       is not None: exp.title       = data.title.strip()
    if data.amount      is not None: exp.amount      = data.amount
    if data.category    is not None: exp.category    = data.category.strip() or None
    if data.category_id is not None: exp.category_id = data.category_id
    if data.fund_id is not None: exp.fund_id = data.fund_id
    if data.vendor_name is not None: exp.vendor_name = data.vendor_name.strip() or None
    if data.expense_date is not None: exp.expense_date = data.expense_date
    if data.note is not None: exp.note = data.note.strip() or None
    if data.receipt_image is not None:
        write_audit(db, "expenses", exp.id, "receipt_change",
                    old_values={"receipt_image": exp.receipt_image},
                    new_values={"receipt_image": data.receipt_image},
                    performed_by_id=actor_id)
        exp.receipt_image = data.receipt_image

    if amount_changed and exp.approved_at:
        # Only adjust ledger if expense has already been approved (i.e. already in funds)
        diff = exp.amount - old_amount
        write_ledger(
            db, "expense", "expense", diff,
            expense_id=exp.id,
            note=f"Adjustment: {exp.title} (was ₹{old_amount:.2f})",
            created_by_id=actor_id,
        )

    write_audit(
        db, "expenses", exp.id, "update",
        old_values=old,
        new_values={"title": exp.title, "amount": exp.amount,
                    "category": exp.category, "category_id": exp.category_id},
        performed_by_id=actor_id,
    )
    db.commit()

    exp = db.query(models.Expense).options(
        joinedload(models.Expense.category_rel),
        joinedload(models.Expense.fund_rel),
    ).filter_by(id=exp.id).first()

    invalidate_dashboard_cache()
    manager.publish_sync("finance", "expense_updated", {
        "expense_id": exp.id, "amount": exp.amount,
    })
    manager.publish_sync("finance", "dashboard_updated", {})
    return _build_expense_out(exp)


@router.patch(
    "/{expense_id}/approve",
    response_model=schemas.ExpenseOut,
    summary="Approve an expense",
)
def approve_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    exp = _get_expense(db, expense_id)
    if exp.approved_at:
        raise HTTPException(400, "Expense is already approved")

    actor_id, actor_name = _actor(user, db)

    # Prevent self-approval: the person who created cannot approve their own expense
    if exp.created_by_id and exp.created_by_id == actor_id:
        raise HTTPException(403, "You cannot approve your own expense")

    exp.approved_by    = actor_name
    exp.approved_by_id = actor_id
    exp.approved_at    = datetime.utcnow()

    # Deduct from funds only now — not at creation time
    write_ledger(
        db, "expense", "expense", exp.amount,
        expense_id=exp.id,
        note=exp.title,
        created_by_id=actor_id,
    )
    write_audit(
        db, "expenses", exp.id, "approve",
        new_values={"approved_by": actor_name, "approved_at": str(exp.approved_at)},
        performed_by_id=actor_id,
    )
    db.commit()

    exp = db.query(models.Expense).options(
        joinedload(models.Expense.category_rel),
        joinedload(models.Expense.fund_rel),
    ).filter_by(id=exp.id).first()

    invalidate_dashboard_cache()
    manager.publish_sync("finance", "expense_approved", {
        "expense_id": exp.id, "approved_by": actor_name,
    })
    manager.publish_sync("finance", "dashboard_updated", {})
    return _build_expense_out(exp)


@router.patch(
    "/{expense_id}/receipt",
    response_model=schemas.ExpenseOut,
    summary="Replace receipt image",
)
def update_receipt(
    expense_id: int,
    receipt_image: str,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    exp = _get_expense(db, expense_id)
    actor_id, _ = _actor(user, db)
    write_audit(db, "expenses", exp.id, "receipt_change",
                old_values={"receipt_image": exp.receipt_image},
                new_values={"receipt_image": receipt_image},
                performed_by_id=actor_id)
    exp.receipt_image = receipt_image
    db.commit()
    exp = db.query(models.Expense).options(
        joinedload(models.Expense.category_rel),
        joinedload(models.Expense.fund_rel),
    ).filter_by(id=exp.id).first()
    return _build_expense_out(exp)


@router.delete(
    "/{expense_id}/receipt",
    summary="Remove receipt image",
)
def delete_receipt(
    expense_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    exp = _get_expense(db, expense_id)
    actor_id, _ = _actor(user, db)
    write_audit(db, "expenses", exp.id, "receipt_change",
                old_values={"receipt_image": exp.receipt_image},
                new_values={"receipt_image": None},
                performed_by_id=actor_id)
    exp.receipt_image = None
    db.commit()
    return {"message": "Receipt removed"}


@router.delete(
    "/{expense_id}",
    summary="Soft-delete expense (superadmin only)",
)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_superadmin),
):
    exp = _get_expense(db, expense_id)
    actor_id, actor_name = _actor(user, db)

    was_approved = exp.approved_at is not None

    exp.is_deleted = True
    exp.deleted_at  = datetime.utcnow()
    exp.deleted_by  = actor_name

    # Reverse the ledger deduction only if this expense had been approved
    if was_approved:
        write_ledger(
            db, "expense", "expense", -exp.amount,
            expense_id=exp.id,
            note=f"Reversal (deleted): {exp.title}",
            created_by_id=actor_id,
        )

    write_audit(
        db, "expenses", exp.id, "delete",
        old_values={"title": exp.title, "amount": exp.amount},
        performed_by_id=actor_id,
    )
    db.commit()
    invalidate_dashboard_cache()
    manager.publish_sync("finance", "expense_deleted", {"expense_id": expense_id})
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"message": "Expense deleted", "expense_id": expense_id}
