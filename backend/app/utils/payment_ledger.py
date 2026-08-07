from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app import models
from app.utils.timezones import add_months, india_month_key, to_india


def _coerce_created_at(created_at) -> datetime:
    if created_at is None:
        return datetime.utcnow()
    if isinstance(created_at, datetime):
        return created_at
    if isinstance(created_at, str):
        text = created_at.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            pass
    return datetime.utcnow()


def generate_receipt_id(db: Session, prefix: str = "CH", created_at=None) -> str:
    """
    Format: MM-{PREFIX}-{YYYYMM}-{000001}
    Example: MM-CH-202607-000001
    Sequence resets every calendar month. Uses transaction date (India TZ).
    Receipt IDs are monotonic and immutable once issued; rollbacks and rejections
    preserve the original receipt so it is never reused.
    """
    dt = to_india(_coerce_created_at(created_at))
    ym = f"{dt.year}{dt.month:02d}"
    pattern = f"MM-{prefix}-{ym}-%"

    model_map = {"CH": models.PaymentEntry, "DN": models.Donation, "EX": models.Expense}
    model_cls = model_map.get(prefix, models.PaymentEntry)

    rows = (
        db.query(model_cls.receipt_id)
        .filter(model_cls.receipt_id.like(pattern))
        .all()
    )

    max_seq = 0
    for (receipt_id,) in rows:
        if not receipt_id:
            continue
        parts = receipt_id.split("-")
        suffix = parts[-1] if parts else ""
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))

    return f"MM-{prefix}-{ym}-{(max_seq or 0) + 1:06d}"


def set_collection_status(collection: models.ChandaCollection) -> None:
    paid = round(float(collection.total_paid or 0), 2)
    due = round(float(collection.amount_due or 0), 2)
    if paid <= 0:
        collection.status = "pending"
    elif paid >= due:
        collection.status = "paid"
    else:
        collection.status = "partial"


def verified_chanda_payments(db: Session, head_id: int):
    return (
        db.query(models.PaymentEntry)
        .filter(models.PaymentEntry.head_id == head_id)
        .filter(models.PaymentEntry.purpose == "Monthly Chanda")
        .filter(models.PaymentEntry.status == "verified")
        .all()
    )


def reserved_future_amounts(db: Session, head_id: int) -> dict[str, float]:
    reserved: dict[str, float] = {}
    for payment in verified_chanda_payments(db, head_id):
        for month_key, amount in (payment.coverage_map or {}).items():
            reserved[month_key] = round(reserved.get(month_key, 0.0) + float(amount or 0), 2)
    return reserved


def build_coverage_map(
    db: Session,
    head: models.ApprovedHead,
    amount: float,
    start_month: str | None = None,
) -> tuple[dict[str, float], float]:
    coverage_map: dict[str, float] = {}
    remaining = round(float(amount or 0), 2)
    collections = (
        db.query(models.ChandaCollection)
        .filter(models.ChandaCollection.head_id == head.id)
        .all()
    )
    if not collections:
        return coverage_map, remaining

    collections_by_month = {collection.month: collection for collection in collections}
    reserved_by_month = reserved_future_amounts(db, head.id)

    # Find earliest unpaid generated month
    months_sorted = sorted(collections_by_month.keys())
    def month_remaining_due(m_key: str) -> float:
        coll = collections_by_month.get(m_key)
        if not coll:
            return 0.0
        paid = float(coll.total_paid or reserved_by_month.get(m_key, 0.0))
        return round(max(float(coll.amount_due or 0) - paid, 0.0), 2)

    earliest_unpaid = None
    for m in months_sorted:
        if month_remaining_due(m) > 0:
            earliest_unpaid = m
            break

    # Prefer an explicit start_month (e.g., from collected_date). If not provided,
    # start from earliest unpaid generated month.
    month_cursor = start_month or earliest_unpaid or india_month_key()
    max_month = months_sorted[-1]

    # Iterate generated months first (oldest pending → newest)
    while remaining > 0 and month_cursor <= max_month:
        collection = collections_by_month.get(month_cursor)
        if not collection:
            month_cursor = add_months(month_cursor, 1)
            continue

        due_amount = round(float(collection.amount_due or 0), 2)
        if due_amount <= 0:
            month_cursor = add_months(month_cursor, 1)
            continue

        already_paid = round(float(collection.total_paid or reserved_by_month.get(month_cursor, 0.0)), 2)
        remaining_due = round(max(due_amount - already_paid, 0), 2)
        if remaining_due <= 0:
            month_cursor = add_months(month_cursor, 1)
            continue

        allocation = round(min(remaining, remaining_due), 2)
        coverage_map[month_cursor] = round(coverage_map.get(month_cursor, 0.0) + allocation, 2)
        remaining = round(remaining - allocation, 2)
        month_cursor = add_months(month_cursor, 1)

    # If excess remains (advance payment), continue allocating to future months
    # that haven't been generated yet. When those months are generated later,
    # sync_generated_month will read this coverage_map and mark them paid.
    monthly_due = round(float(head.monthly_amount or 0), 2)
    if remaining > 0 and monthly_due > 0:
        future_cursor = month_cursor  # already points past max_month
        max_advance_months = 24       # safety cap
        for _ in range(max_advance_months):
            if remaining <= 0:
                break
            already_reserved = round(float(reserved_by_month.get(future_cursor, 0.0)), 2)
            remaining_due = round(max(monthly_due - already_reserved, 0), 2)
            if remaining_due <= 0:
                future_cursor = add_months(future_cursor, 1)
                continue
            allocation = round(min(remaining, remaining_due), 2)
            coverage_map[future_cursor] = round(coverage_map.get(future_cursor, 0.0) + allocation, 2)
            remaining = round(remaining - allocation, 2)
            future_cursor = add_months(future_cursor, 1)

    return coverage_map, remaining


def apply_coverage_to_collections(
    collections: list[models.ChandaCollection],
    coverage_map: dict[str, float],
    *,
    reverse: bool = False,
) -> None:
    if not coverage_map:
        return

    for collection in collections:
        allocation = round(float(coverage_map.get(collection.month, 0.0)), 2)
        if allocation <= 0:
            continue
        current_paid = round(float(collection.total_paid or 0), 2)
        if reverse:
            collection.total_paid = round(max(current_paid - allocation, 0.0), 2)
        else:
            collection.total_paid = round(min(float(collection.amount_due or 0), current_paid + allocation), 2)
        set_collection_status(collection)


def apply_coverage_to_generated_collections(
    db: Session,
    head_id: int,
    coverage_map: dict[str, float],
    *,
    reverse: bool = False,
) -> None:
    if not coverage_map:
        return

    months = [month for month in coverage_map.keys() if month]
    if not months:
        return

    collections = (
        db.query(models.ChandaCollection)
        .filter(models.ChandaCollection.head_id == head_id)
        .filter(models.ChandaCollection.month.in_(months))
        .all()
    )
    apply_coverage_to_collections(collections, coverage_map, reverse=reverse)


def apply_coverage_to_existing_collections(
    db: Session,
    head_id: int,
    coverage_map: dict[str, float],
) -> None:
    if not coverage_map:
        return

    collections = (
        db.query(models.ChandaCollection)
        .filter(models.ChandaCollection.head_id == head_id)
        .filter(models.ChandaCollection.month.in_(list(coverage_map.keys())))
        .all()
    )
    apply_coverage_to_collections(collections, coverage_map)


def sync_generated_month(db: Session, collection: models.ChandaCollection) -> None:
    allocated_total = 0.0
    source_payment_id: int | None = None

    for payment in verified_chanda_payments(db, collection.head_id):
        allocated = float((payment.coverage_map or {}).get(collection.month, 0.0) or 0.0)
        if allocated > 0:
            allocated_total += allocated
            # Track the earliest payment that covers this month
            if source_payment_id is None:
                source_payment_id = payment.id

    collection.total_paid = round(min(float(collection.amount_due), allocated_total), 2)
    set_collection_status(collection)

    # Mark as advance when the covering payment was collected in a different month
    if source_payment_id and allocated_total > 0:
        source = db.query(models.PaymentEntry).filter_by(id=source_payment_id).first()
        if source and source.collected_at:
            source_month = india_month_key(source.collected_at)
            if source_month != collection.month:
                collection.is_advance = True
                collection.advance_payment_id = source_payment_id
                return
    collection.is_advance = False
    collection.advance_payment_id = None
