from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from typing import List

from app import models, schemas
from app.database import SessionLocal
from app.security import require_admin, require_collector
from app.utils.payment_ledger import (
    apply_rate_to_open_months,
    apply_coverage_to_existing_collections,
    apply_coverage_to_generated_collections,
    build_coverage_map,
    generate_receipt_id,
    set_collection_status,
    sync_generated_month,
)
from app.utils.chanda_months import (
    current_month_key,
    generated_month_filter,
    pending_month_filter,
    visible_month_filter,
)
from app.utils.timezones import add_months, india_month_key, parse_frontend_datetime, utc_now_naive
from app.websocket_manager import manager
from app.routes.finance import write_audit, write_ledger
from app.rate_limit import rate_limit
from app.utils.fcm import notify_user
from app.utils.payment_notify import notify_chanda_payment_later

router = APIRouter(prefix="/chanda", tags=["Chanda"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_month() -> str:
    return current_month_key()


def normalize_purpose(raw_purpose: str | None) -> str:
    value = (raw_purpose or "").strip().lower()
    if value in {"chanda", "monthly chanda"}:
        return "Monthly Chanda"
    if value == "donation":
        return "Donation"
    if value:
        return raw_purpose.strip()
    return "Monthly Chanda"


def validate_rollback_decision(request: models.PaymentRollbackRequest, acting_user_id: int) -> None:
    if request.requested_by_id == acting_user_id:
        raise HTTPException(status_code=403, detail="You cannot approve or reject your own rollback request")


@router.get("/members", response_model=List[schemas.MemberWithCollection])
def get_members(
    month: str | None = None,
    include_history: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(require_collector),
):
    heads = db.query(models.ApprovedHead).filter(models.ApprovedHead.is_deleted.is_(False)).all()
    target_month = month or get_current_month()
    head_ids = [h.id for h in heads]
    if not head_ids:
        return []

    # Bulk load collections (single query instead of N)
    if include_history:
        # Generated months + any month paid in advance — see utils/chanda_months.
        all_cols = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.head_id.in_(head_ids),
                visible_month_filter(),
            )
            .order_by(models.ChandaCollection.month.desc())
            .all()
        )
        cols_by_head: dict[int, list] = defaultdict(list)
        for c in all_cols:
            if len(cols_by_head[c.head_id]) < 12:
                cols_by_head[c.head_id].append(c)
    else:
        all_cols = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.head_id.in_(head_ids),
                models.ChandaCollection.month == target_month,
                visible_month_filter(),
            )
            .all()
        )
        cols_by_head: dict[int, list] = defaultdict(list)
        for c in all_cols:
            cols_by_head[c.head_id].append(c)

    # Bulk load pending month counts (single query).
    # Generated months only — see utils/chanda_months.
    pending_rows = (
        db.query(
            models.ChandaCollection.head_id,
            func.count(models.ChandaCollection.id),
        )
        .filter(
            models.ChandaCollection.head_id.in_(head_ids),
            models.ChandaCollection.status != "paid",
            pending_month_filter(),
        )
        .group_by(models.ChandaCollection.head_id)
        .all()
    )
    pending_by_head = {hid: cnt for hid, cnt in pending_rows}

    # Bulk load latest verified payment per head (single query)
    from sqlalchemy import text as _txt
    lp_rows = db.execute(_txt("""
        SELECT DISTINCT ON (head_id)
            head_id, created_at, collected_by
        FROM payment_entries
        WHERE head_id = ANY(:ids) AND status = 'verified'
        ORDER BY head_id, created_at DESC
    """), {"ids": head_ids}).fetchall()
    lp_by_head = {r[0]: (r[1], r[2]) for r in lp_rows}

    # Bulk load latest donation per head (single query)
    don_rows = db.execute(_txt("""
        SELECT DISTINCT ON (head_id)
            head_id, created_at
        FROM donations
        WHERE head_id = ANY(:ids)
        ORDER BY head_id, created_at DESC
    """), {"ids": head_ids}).fetchall()
    cutoff = utc_now_naive() - timedelta(days=30)
    don_by_head = {r[0]: r[1] for r in don_rows}

    result = []
    for head in heads:
        entry = {
            "member": head,
            "collections": cols_by_head.get(head.id, []),
            "pending_months_count": pending_by_head.get(head.id, 0),
        }
        lp = lp_by_head.get(head.id)
        if lp:
            entry["last_payment_date"] = lp[0].strftime("%d %b %Y") if lp[0] else None
            entry["last_collector"] = lp[1]
        don_at = don_by_head.get(head.id)
        if don_at:
            entry["recent_donation"] = don_at >= cutoff

        result.append(entry)

    return result


@router.post("/generate")
def generate_month(
    data: schemas.ChandaGenerate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    month = data.month
    heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
    if not heads:
        raise HTTPException(400, "No active family heads found")

    for head in heads:
        amount = head.monthly_amount or 0
        collection = (
            db.query(models.ChandaCollection)
            .filter_by(head_id=head.id, month=month)
            .first()
        )
        if collection:
            # Only update amount_due if not yet paid — preserve history
            if collection.status == "pending":
                collection.amount_due = amount
        else:
            collection = models.ChandaCollection(
                head_id=head.id,
                month=month,
                amount_due=amount,
                total_paid=0,
                status="pending",
                rate_snapshot=amount,
            )
            db.add(collection)
            db.flush()

        sync_generated_month(db, collection)
        set_collection_status(collection)

    db.commit()
    return {"message": f"Month {month} generated for {len(heads)} families"}


@router.post("/collect", response_model=schemas.PaymentOut)
async def collect_payment(
    data: schemas.PaymentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_collector),
):
    await rate_limit(request, "collector_write")
    # Idempotency: return existing payment if token already used
    if data.payment_token:
        existing = db.query(models.PaymentEntry).filter_by(payment_token=data.payment_token).first()
        if existing:
            return existing

    head = db.query(models.ApprovedHead).filter_by(id=data.member_id).first()
    if not head:
        raise HTTPException(404, "Head not found")
    if data.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")

    purpose = normalize_purpose(data.purpose)
    db_user = db.query(models.User).filter_by(id=int(user.get("sub"))).first()
    collector_name = db_user.name if db_user else "Collector"
    created_at = utc_now_naive()
    # collected_at = the actual wall-clock time the collector submits.
    # collected_date (YYYY-MM-DD) is used only to derive the start_month for coverage;
    # it must NOT become the collected_at timestamp or the admin log shows midnight.
    collected_at = created_at

    # Parse collected_date only for start_month derivation (now mostly superseded by months_list)
    _visit_date_for_month: str | None = None
    if data.collected_date:
        try:
            cd = data.collected_date.strip()
            d_only = datetime.strptime(cd[:10], "%Y-%m-%d")
            _visit_date_for_month = india_month_key(d_only)
        except Exception:
            pass
    coverage_map = {}

    if purpose == "Monthly Chanda":
        monthly_amount = round(float(head.monthly_amount or 0), 2)

        # Explicit month list from UI (specific months tapped by collector)
        if data.months_list:
            for m_key in data.months_list:
                col = (
                    db.query(models.ChandaCollection)
                    .filter_by(head_id=head.id, month=m_key)
                    .first()
                )
                if not col:
                    col = models.ChandaCollection(
                        head_id=head.id, month=m_key,
                        amount_due=monthly_amount, total_paid=0, status="pending",
                    )
                    db.add(col)
                    db.flush()
                due = round(float(col.amount_due or monthly_amount), 2)
                already = round(float(col.total_paid or 0), 2)
                allocation = round(max(due - already, 0), 2)
                if allocation > 0:
                    coverage_map[m_key] = round(coverage_map.get(m_key, 0.0) + allocation, 2)

        else:
            # Explicit single start_month from collector UI
            start_month = data.month or _visit_date_for_month

            if start_month:
                n_months = max(int(data.months or 1), 1)
                cursor = start_month
                for _ in range(n_months):
                    col = (
                        db.query(models.ChandaCollection)
                        .filter_by(head_id=head.id, month=cursor)
                        .first()
                    )
                    if not col:
                        col = models.ChandaCollection(
                            head_id=head.id, month=cursor,
                            amount_due=monthly_amount, total_paid=0, status="pending",
                        )
                        db.add(col)
                        db.flush()
                    due = round(float(col.amount_due or monthly_amount), 2)
                    already = round(float(col.total_paid or 0), 2)
                    allocation = round(max(due - already, 0), 2)
                    if allocation > 0:
                        coverage_map[cursor] = round(coverage_map.get(cursor, 0.0) + allocation, 2)
                    cursor = add_months(cursor, 1)
            else:
                coverage_map, unallocated = build_coverage_map(db, head, data.amount, None)

        if not coverage_map:
            raise HTTPException(400, "Could not allocate payment across months")
        apply_coverage_to_existing_collections(db, head.id, coverage_map)

    # months_covered = only months that are NOW fully paid after this collection
    covered_keys = sorted(coverage_map.keys())
    fully_paid_count = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id == head.id,
            models.ChandaCollection.month.in_(covered_keys),
            models.ChandaCollection.status == "paid",
        )
        .count()
    ) if covered_keys else 0

    payment = models.PaymentEntry(
        collection_id=None,
        head_id=head.id,
        paid_by_user_id=int(user.get("sub")),
        collector_id=int(user.get("sub")),
        amount=data.amount,
        method=(data.method or "cash").lower(),
        created_at=created_at,
        collected_by=collector_name,
        collected_at=collected_at,
        transaction_ref=data.transaction_ref,
        proof_image=data.proof_image,
        status="verified",
        created_by="collector",
        verified_by=collector_name,
        verified_at=created_at,
        receipt_id=generate_receipt_id(db, prefix="CH", created_at=created_at),
        purpose=purpose,
        months_covered=fully_paid_count,
        covered_months=covered_keys,
        coverage_map=coverage_map or None,
        monthly_rate_snapshot=round(float(head.monthly_amount or 0), 2),
        gross_amount=data.amount,
        discount_amount=0,
        payment_token=data.payment_token or None,
    )

    db.add(payment)
    db.flush()

    write_ledger(
        db, "chanda", "income", data.amount,
        family_id=head.id, payment_entry_id=payment.id,
        month=india_month_key(collected_at),   # always the month cash was physically received
        note=f"Collected by {collector_name}" + (f" (covers: {', '.join(list(coverage_map.keys())[:3])}{'…' if len(coverage_map) > 3 else ''})" if coverage_map else ""),
    )
    write_audit(
        db, "payment_entries", payment.id, "create",
        new_values={"amount": data.amount, "method": data.method, "head_id": head.id},
        performed_by_id=int(user.get("sub")),
    )

    db.commit()
    db.refresh(payment)

    manager.publish_sync("finance", "payment_collected", {
        "payment_id": payment.id,
        "head_id": head.id,
        "months": payment.covered_months or [],
    })
    if payment.receipt_id:
        manager.broadcast_sync(
            f"receipt:{payment.receipt_id}",
            {
                "type": "receipt_update",
                "payload": schemas.PaymentOut.model_validate(payment).model_dump(exclude_none=True),
            },
        )
    # Pushed ~2.5s later on its own session so FCM latency never delays
    # this response. Wording is derived from payment.created_by.
    background_tasks.add_task(notify_chanda_payment_later, payment.id)
    return payment


@router.put("/verify/{payment_id}", response_model=schemas.PaymentOut)
def verify_payment(
    payment_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    payment = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status == "verified":
        return payment

    admin_user = db.query(models.User).filter_by(id=int(user.get("sub"))).first()
    verifier_name = admin_user.name if admin_user else "Admin"
    payment.status = "verified"
    payment.verified_by = verifier_name
    payment.verified_at = utc_now_naive()

    if payment.purpose == "Monthly Chanda":
        head = db.query(models.ApprovedHead).filter_by(id=payment.head_id).first()
        if not head:
            raise HTTPException(404, "Head not found")
        coverage_map = payment.coverage_map or {}
        if payment.created_by == "user" or not coverage_map:
            start_month = None
            if payment.collected_at:
                start_month = india_month_key(payment.collected_at)
            coverage_map, unallocated = build_coverage_map(db, head, payment.amount, start_month)
            if not coverage_map or unallocated > 0:
                raise HTTPException(400, "Could not allocate payment across months")
            payment.coverage_map = coverage_map
            payment.covered_months = list(coverage_map.keys())
            payment.months_covered = len(coverage_map)
        apply_coverage_to_existing_collections(db, head.id, coverage_map)

    final_map = payment.coverage_map or {}
    ledger_month = india_month_key(payment.collected_at) if payment.collected_at else (list(final_map.keys())[0] if final_map else None)
    write_ledger(
        db, "chanda", "income", payment.amount,
        family_id=payment.head_id, payment_entry_id=payment.id,
        month=ledger_month,
        note=f"Verified by {verifier_name}",
    )
    write_audit(
        db, "payment_entries", payment.id, "verify",
        new_values={"status": "verified", "verified_by": verifier_name},
        performed_by_id=int(user.get("sub")),
    )

    db.commit()
    db.refresh(payment)
    manager.publish_sync("finance", "payment_verified", {"payment_id": payment.id, "head_id": payment.head_id})
    if payment.receipt_id:
        manager.broadcast_sync(
            f"receipt:{payment.receipt_id}",
            {
                "type": "receipt_update",
                "payload": schemas.PaymentOut.model_validate(payment).model_dump(exclude_none=True),
            },
        )
    # Personal push to the user who submitted this payment
    # Pushed ~2.5s later on its own session so FCM latency never delays
    # this response. Wording is derived from payment.created_by.
    background_tasks.add_task(notify_chanda_payment_later, payment.id)
    return payment


@router.put("/reject/{payment_id}", response_model=schemas.PaymentOut)
def reject_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    payment = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status == "verified":
        raise HTTPException(400, "Cannot reject an already verified payment")

    admin_user = db.query(models.User).filter_by(id=int(user.get("sub"))).first()
    verifier_name = admin_user.name if admin_user else "Admin"
    payment.status = "rejected"
    payment.verified_by = verifier_name
    payment.verified_at = utc_now_naive()

    write_audit(
        db, "payment_entries", payment.id, "reject",
        new_values={"status": "rejected", "rejected_by": verifier_name},
        performed_by_id=int(user.get("sub")),
    )
    db.commit()
    db.refresh(payment)
    manager.publish_sync("finance", "payment_rejected", {"payment_id": payment.id, "head_id": payment.head_id})
    if payment.paid_by_user_id:
        notify_user(
            db, payment.paid_by_user_id,
            title="❌ Payment Rejected",
            body=f"Your payment of ₹{payment.amount:.0f} was rejected. Please contact the masjid for details.",
            data={"type": "payment_rejected", "payment_id": str(payment.id)},
        )
    return payment


@router.post("/rollback-request")
def request_payment_rollback(
    payload: dict,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    payment_id = payload.get("payment_id")
    reason = payload.get("reason")
    if not payment_id:
        raise HTTPException(400, "payment_id is required")

    payment = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "verified":
        raise HTTPException(400, "Only verified payments can be rolled back")

    existing = (
        db.query(models.PaymentRollbackRequest)
        .filter_by(payment_entry_id=payment_id, status="pending")
        .first()
    )
    if existing:
        raise HTTPException(409, "A pending rollback request already exists")

    request = models.PaymentRollbackRequest(
        payment_entry_id=payment_id,
        requested_by_id=int(user.get("sub")),
        reason=reason,
        original_amount=payment.amount,
        original_receipt_id=payment.receipt_id,
        original_covered_months=payment.covered_months,
        payment_source=payment.payment_source,
    )
    db.add(request)
    payment.rollback_status = "pending"
    db.commit()
    db.refresh(request)

    admin_users = db.query(models.User).filter(models.User.role.in_(["admin", "superadmin"]), models.User.is_active.is_(True)).all()
    for admin_user in admin_users:
        notify_user(
            db,
            admin_user.id,
            title="🔄 Rollback Requested",
            body=f"{payment.receipt_id or 'Payment'} needs approval for rollback",
            data={
                "type": "rollback_request",
                "request_id": str(request.id),
                "payment_id": str(payment.id),
            },
        )

    manager.publish_sync("finance", "rollback_requested", {"request_id": request.id, "payment_id": payment.id})
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"message": "Rollback request submitted", "request_id": request.id}


@router.post("/rollback-approve/{request_id}")
def approve_payment_rollback(
    request_id: int,
    payload: dict | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    request = db.query(models.PaymentRollbackRequest).filter_by(id=request_id).first()
    if not request:
        raise HTTPException(404, "Rollback request not found")
    if request.status != "pending":
        raise HTTPException(400, "Rollback request is not pending")

    payment = db.query(models.PaymentEntry).filter_by(id=request.payment_entry_id).first()
    if not payment:
        raise HTTPException(404, "Payment not found")

    validate_rollback_decision(request, int(user.get("sub")))

    head = db.query(models.ApprovedHead).filter_by(id=payment.head_id).first()
    if not head:
        raise HTTPException(404, "Head not found")

    if payment.purpose == "Monthly Chanda" and payment.coverage_map:
        apply_coverage_to_generated_collections(db, head.id, payment.coverage_map, reverse=True)

    payment.status = "rejected"
    payment.rollback_status = "approved"
    request.status = "approved"
    request.approved_by_id = int(user.get("sub"))
    request.approved_at = utc_now_naive()
    request.decision_note = (payload or {}).get("decision_note")

    write_audit(
        db, "payment_entries", payment.id, "rollback_approve",
        new_values={"status": "rejected", "rollback_status": "approved"},
        performed_by_id=int(user.get("sub")),
    )
    db.commit()
    manager.publish_sync("finance", "rollback_approved", {"request_id": request.id, "payment_id": payment.id})
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"message": "Rollback approved"}


@router.post("/rollback-reject/{request_id}")
def reject_payment_rollback(
    request_id: int,
    payload: dict | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    request = db.query(models.PaymentRollbackRequest).filter_by(id=request_id).first()
    if not request:
        raise HTTPException(404, "Rollback request not found")
    if request.status != "pending":
        raise HTTPException(400, "Rollback request is not pending")

    payment = db.query(models.PaymentEntry).filter_by(id=request.payment_entry_id).first()
    if not payment:
        raise HTTPException(404, "Payment not found")

    validate_rollback_decision(request, int(user.get("sub")))

    payment.rollback_status = "rejected"
    request.status = "rejected"
    request.approved_by_id = int(user.get("sub"))
    request.approved_at = utc_now_naive()
    request.decision_note = (payload or {}).get("decision_note")

    write_audit(
        db, "payment_entries", payment.id, "rollback_reject",
        new_values={"rollback_status": "rejected"},
        performed_by_id=int(user.get("sub")),
    )
    db.commit()
    manager.publish_sync("finance", "rollback_rejected", {"request_id": request.id, "payment_id": payment.id})
    manager.publish_sync("finance", "dashboard_updated", {})
    return {"message": "Rollback rejected"}


@router.post("/admin-record", response_model=schemas.PaymentOut)
def admin_record_payment(
    data: schemas.AdminPaymentRecord,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """
    Admin manually records a verified payment for any family.
    Use when cash was handed directly to admin, or to correct a missed entry.
    Generates receipt and broadcasts WebSocket update to mobile user.
    """
    head = db.query(models.ApprovedHead).filter_by(id=data.member_id).first()
    if not head:
        raise HTTPException(404, "Head not found")
    if data.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")

    admin_user = db.query(models.User).filter_by(id=int(user.get("sub"))).first()
    admin_name = admin_user.name if admin_user else "Admin"
    server_now = utc_now_naive()
    created_at = server_now
    # Use device-reported collection time if provided (stored for audit alongside server time)
    device_collected_at = server_now
    if data.collected_date:
        try:
            # Honour the offset the client sent instead of discarding it.
            # Stripping the "Z" parsed the value as naive and stored a wall clock
            # as if it were UTC; the client then rendered it back in local time and
            # added the offset a second time, so a payment taken at 12:12 AM
            # appeared on the receipt as 5:41 AM. Normalising "Z" to "+00:00"
            # keeps the value timezone-aware, and parse_frontend_datetime converts
            # any offset to the naive UTC the column stores — correct from any
            # timezone, with no fixed offset anywhere.
            parsed = datetime.fromisoformat(data.collected_date.replace("Z", "+00:00"))
            device_collected_at = parse_frontend_datetime(parsed) or server_now
        except ValueError:
            pass
    monthly_amount = round(float(head.monthly_amount or 0), 2)
    coverage_map: dict = {}

    purpose = normalize_purpose(data.purpose)

    if purpose == "Monthly Chanda":
        if data.months_list:
            for m_key in data.months_list:
                col = (
                    db.query(models.ChandaCollection)
                    .filter_by(head_id=head.id, month=m_key)
                    .first()
                )
                if not col:
                    col = models.ChandaCollection(
                        head_id=head.id, month=m_key,
                        amount_due=monthly_amount, total_paid=0, status="pending",
                    )
                    db.add(col)
                    db.flush()
                due = round(float(col.amount_due or monthly_amount), 2)
                already = round(float(col.total_paid or 0), 2)
                allocation = round(max(due - already, 0), 2)
                if allocation > 0:
                    coverage_map[m_key] = round(coverage_map.get(m_key, 0.0) + allocation, 2)
        else:
            coverage_map, _ = build_coverage_map(db, head, data.amount, data.start_month)

        if not coverage_map:
            raise HTTPException(400, "Could not determine which months to cover. Specify months_list explicitly.")
        apply_coverage_to_existing_collections(db, head.id, coverage_map)
        # Reconcile amount with actual coverage to ensure ledger accuracy
        if data.months_list:
            data.amount = round(sum(coverage_map.values()), 2)
            if data.amount <= 0:
                raise HTTPException(400, "All selected months are already fully paid")

    admin_covered_keys = sorted(coverage_map.keys())
    admin_fully_paid_count = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id == head.id,
            models.ChandaCollection.month.in_(admin_covered_keys),
            models.ChandaCollection.status == "paid",
        )
        .count()
    ) if admin_covered_keys else 0

    payment = models.PaymentEntry(
        collection_id=None,
        head_id=head.id,
        paid_by_user_id=None,
        amount=data.amount,
        method=(data.method or "cash").lower(),
        created_at=created_at,
        collected_by=admin_name,
        collected_at=device_collected_at,
        transaction_ref=data.transaction_ref,
        proof_image=None,
        status="verified",
        created_by="admin",
        verified_by=admin_name,
        verified_at=created_at,
        receipt_id=generate_receipt_id(db, prefix="CH", created_at=created_at),
        purpose=purpose,
        months_covered=admin_fully_paid_count,
        covered_months=admin_covered_keys,
        coverage_map=coverage_map or None,
        notes=data.note,
        monthly_rate_snapshot=round(float(head.monthly_amount or 0), 2),
        gross_amount=data.amount,
        discount_amount=0,
    )

    db.add(payment)
    db.flush()

    if purpose == "Monthly Chanda":
        write_ledger(
            db, "chanda", "income", data.amount,
            family_id=head.id, payment_entry_id=payment.id,
            month=india_month_key(device_collected_at),   # cash received month
            note=f"Manual entry by {admin_name}" + (f": {data.note}" if data.note else ""),
        )

    write_audit(
        db, "payment_entries", payment.id, "create",
        new_values={"amount": data.amount, "method": data.method, "head_id": head.id, "manual": True},
        performed_by_id=int(user.get("sub")),
    )

    db.commit()
    db.refresh(payment)

    manager.publish_sync("finance", "payment_collected", {
        "payment_id": payment.id, "head_id": head.id,
        "months": payment.covered_months or [], "manual": True,
    })
    if payment.receipt_id:
        manager.broadcast_sync(
            f"receipt:{payment.receipt_id}",
            {"type": "receipt_update",
             "payload": schemas.PaymentOut.model_validate(payment).model_dump(exclude_none=True)},
        )
    # Pushed ~2.5s later on its own session so FCM latency never delays
    # this response. Wording is derived from payment.created_by.
    background_tasks.add_task(notify_chanda_payment_later, payment.id)

    return payment


@router.get("/report/{month}")
def get_report(
    month: str,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    # A future month reports only the families who paid it in advance — never
    # the blank rows left behind by the historical import (utils/chanda_months).
    # joinedload: total_due reads collection.head.is_active below, which lazily
    # fired one SELECT per row — 422 queries for a 421-family month.
    collections = (
        db.query(models.ChandaCollection)
        .options(joinedload(models.ChandaCollection.head))
        .filter(
            models.ChandaCollection.month == month,
            visible_month_filter(),
        )
        .all()
    )
    # "Expected" (amount_due) excludes families deactivated before paying —
    # already-paid amounts always count regardless of current active status.
    total_due = sum(
        collection.amount_due for collection in collections
        if collection.status == "paid" or (collection.head and collection.head.is_active)
    )
    total_paid = sum(collection.total_paid for collection in collections)
    pending = len([collection for collection in collections if collection.status != "paid"])

    return {
        "month": month,
        "total_heads": len(collections),
        "total_due": total_due,
        "total_collected": total_paid,
        "pending_heads": pending,
    }


@router.get("/member/{member_id}", response_model=schemas.MemberWithCollection)
def get_member_history(
    member_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_collector),
):
    """Returns member's chanda collection history.

    Generated months plus any month already paid in advance; unpaid ungenerated
    months are excluded — see utils/chanda_months.
    """
    head = db.query(models.ApprovedHead).filter_by(id=member_id).first()
    if not head:
        raise HTTPException(404, "Head not found")

    collections = (
        db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id == head.id,
            visible_month_filter(),
        )
        .order_by(models.ChandaCollection.month)
        .all()
    )

    return {"member": head, "collections": collections}


@router.get("/advance-limit")
def get_advance_limit(
    db: Session = Depends(get_db),
    user=Depends(require_collector),
):
    """Returns the configured advance payment month limit (default 12)."""
    setting = db.query(models.FinanceSetting).filter_by(key="advance_months_limit").first()
    limit = int(setting.value) if setting and setting.value else 12
    return {"advance_months_limit": limit}


@router.put("/advance-limit")
def set_advance_limit(
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Set advance payment month limit. Value: 3, 6, 12, or 0 (unlimited = 24)."""
    limit = int(data.get("advance_months_limit", 12))
    setting = db.query(models.FinanceSetting).filter_by(key="advance_months_limit").first()
    if setting:
        setting.value = str(limit)
    else:
        db.add(models.FinanceSetting(key="advance_months_limit", value=str(limit)))
    db.commit()
    return {"advance_months_limit": limit}


@router.get("/available-months/{member_id}")
def get_available_months(
    member_id: int,
    future: int = Query(12, ge=1, le=24),
    db: Session = Depends(get_db),
    user=Depends(require_collector),
):
    """
    Returns all selectable months for a member's advance payment:
    - Generated unpaid months (oldest first)
    - N future months not yet generated
    Each entry shows: month, amount_due, total_paid, remaining, status, is_advance, advance_payment_id
    Advance months that are already fully covered are excluded from the selectable list
    but included with is_advance=True so the UI can show "Already Paid in Advance".
    """
    head = db.query(models.ApprovedHead).filter_by(id=member_id).first()
    if not head:
        raise HTTPException(404, "Head not found")

    # Enforce configurable advance limit
    limit_setting = db.query(models.FinanceSetting).filter_by(key="advance_months_limit").first()
    max_future = int(limit_setting.value) if limit_setting and limit_setting.value else 12
    if max_future == 0:
        max_future = 24   # 0 = "Unlimited" capped at 24 for UI safety
    future = min(future, max_future)

    monthly_amount = round(float(head.monthly_amount or 0), 2)
    reserved = {}
    for payment in db.query(models.PaymentEntry).filter_by(head_id=head.id, purpose="Monthly Chanda", status="verified").all():
        for mk, amt in (payment.coverage_map or {}).items():
            reserved[mk] = round(reserved.get(mk, 0.0) + float(amt or 0), 2)

    # Generated collections only — see utils/chanda_months. Rows beyond the
    # current month are not generated and are offered below as advance months.
    generated = {
        c.month: c
        for c in db.query(models.ChandaCollection)
        .filter(
            models.ChandaCollection.head_id == head.id,
            generated_month_filter(),
        )
        .all()
    }

    result = []

    # Unpaid generated months (selectable)
    for month_key in sorted(generated.keys()):
        col = generated[month_key]
        remaining = round(max(float(col.amount_due) - float(col.total_paid or 0), 0), 2)
        result.append({
            "month": month_key,
            "amount_due": float(col.amount_due),
            "total_paid": float(col.total_paid or 0),
            "remaining": remaining,
            "status": col.status,
            "is_advance": col.is_advance or False,
            "advance_payment_id": col.advance_payment_id,
            "is_generated": True,
        })

    # Future months (not yet generated)
    last_month = sorted(generated.keys())[-1] if generated else current_month_key()
    cursor = add_months(last_month, 1)
    for _ in range(future):
        already_reserved = round(float(reserved.get(cursor, 0.0)), 2)
        remaining = round(max(monthly_amount - already_reserved, 0), 2)
        result.append({
            "month": cursor,
            "amount_due": monthly_amount,
            "total_paid": already_reserved,
            "remaining": remaining,
            "status": "paid" if already_reserved >= monthly_amount else "pending",
            "is_advance": already_reserved > 0,
            "advance_payment_id": None,
            "is_generated": False,
        })
        cursor = add_months(cursor, 1)

    return result


@router.post("/update-rate/{member_id}")
def update_chanda_rate(
    member_id: int,
    data: schemas.ChandaRateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """
    Update a member's monthly chanda amount.
    Cascades to every month that is not fully settled, plus future months:
    - Paid months are never re-priced, including months paid in advance
    - If the old rate was a typo, correcting it clears the phantom balance
    - Fully-paid past months and historical receipts / coverage_map are never touched
    """
    head = db.query(models.ApprovedHead).filter_by(id=member_id).first()
    if not head:
        raise HTTPException(404, "Head not found")

    old_rate = float(head.monthly_amount or 0)
    new_rate = round(float(data.monthly_amount), 2)
    if new_rate <= 0:
        raise HTTPException(400, "Monthly amount must be greater than zero")

    head.monthly_amount = new_rate
    apply_rate_to_open_months(db, head.id, new_rate)

    db.commit()

    admin_user = db.query(models.User).filter_by(id=int(user.get("sub"))).first()
    write_audit(
        db, "approved_heads", head.id, "update",
        new_values={"monthly_amount": new_rate, "old_monthly_amount": old_rate},
        performed_by_id=int(user.get("sub")),
        action_label="Chanda Rate Updated",
        module="Finance",
        user_fullname=admin_user.name if admin_user else None,
        user_role=user.get("role"),
        status="success",
    )
    db.commit()

    return {"message": f"Rate updated from ₹{old_rate} to ₹{new_rate}", "affected_months": len(future_cols)}


@router.get("/defaulters")
def get_defaulters(
    months: int = 3,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Returns families with N+ pending generated months.

    Generated months only — see utils/chanda_months.

    Counted with one GROUP BY instead of a query per family: at 421 families the
    per-family loop cost 422 round-trips, which is seconds of latency once the
    database is a network hop away rather than localhost.
    """
    pending_counts = (
        db.query(
            models.ChandaCollection.head_id,
            func.count(models.ChandaCollection.id).label("pending_months"),
        )
        .join(models.ApprovedHead, models.ApprovedHead.id == models.ChandaCollection.head_id)
        .filter(
            models.ApprovedHead.is_deleted.is_(False),
            models.ChandaCollection.status != "paid",
            pending_month_filter(),
        )
        .group_by(models.ChandaCollection.head_id)
        .having(func.count(models.ChandaCollection.id) >= months)
        .all()
    )
    if not pending_counts:
        return {"threshold_months": months, "count": 0, "items": []}

    by_head = {head_id: count for head_id, count in pending_counts}
    heads = (
        db.query(models.ApprovedHead)
        .filter(models.ApprovedHead.id.in_(list(by_head.keys())))
        .all()
    )
    items = [{"head": head, "pending_months": by_head[head.id]} for head in heads]
    items.sort(key=lambda i: i["pending_months"], reverse=True)

    return {"threshold_months": months, "count": len(items), "items": items}
