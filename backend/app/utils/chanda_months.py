"""
Single source of truth for which chanda months count as pending vs. visible.

Background
----------
Month generation (scheduler.job_generate_chanda_month,
admin._auto_generate_months_for_head, admin.generate_pending_months,
registration_service) always stops at the current India month. Rows can still
exist beyond it because the historical Excel import writes one row per month
column in the sheet — including months paid in advance and months left blank.

Two different rules, deliberately kept apart
--------------------------------------------
``pending_month_filter()`` — a month is pending only once it has been generated.
An ungenerated future month is never pending, never a defaulter month, never in
outstanding, and never triggers a reminder.

``visible_month_filter()`` — a month is worth showing when it has been generated
OR someone actually paid it. That second half is what keeps advance payments
visible: a family who paid through December still shows Sep–Dec as Paid even
though those months are not generated yet.

So for the same family, an unpaid future month vanishes while a paid one stays.
Use ``pending_month_filter()`` for counts/defaulters/outstanding and
``visible_month_filter()`` for history, statements and month reports. Never
derive either from the calendar.
"""

from sqlalchemy import func, or_
from sqlalchemy.sql.elements import ColumnElement

from app import models
from app.utils.timezones import india_month_key, utc_now


def current_month_key() -> str:
    """Current month in India time as ``YYYY-MM``."""
    return india_month_key(utc_now())


def _paid_anything() -> ColumnElement:
    return func.coalesce(models.ChandaCollection.total_paid, 0.0) > 0


def is_generated_month(month: str, *, current_month: str | None = None) -> bool:
    """True when ``month`` (``YYYY-MM``) has already been generated."""
    return month <= (current_month or current_month_key())


def is_visible_month(
    month: str,
    total_paid: float | None,
    *,
    current_month: str | None = None,
) -> bool:
    """True when the month is generated, or carries a real (advance) payment."""
    return is_generated_month(month, current_month=current_month) or float(total_paid or 0) > 0


def generated_month_filter(current_month: str | None = None) -> ColumnElement:
    """Criterion restricting ChandaCollection to generated months only."""
    return models.ChandaCollection.month <= (current_month or current_month_key())


def pending_month_filter(current_month: str | None = None) -> ColumnElement:
    """Criterion for rows that may legitimately be counted as pending."""
    return generated_month_filter(current_month)


def visible_month_filter(current_month: str | None = None) -> ColumnElement:
    """Criterion for rows worth displaying: generated, or paid in advance."""
    return or_(generated_month_filter(current_month), _paid_anything())
