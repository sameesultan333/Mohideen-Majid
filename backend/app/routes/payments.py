from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import SessionLocal
from app.security import require_admin

router = APIRouter(prefix="/payments", tags=["Payments"])


def _payment_to_dict(payment: models.PaymentEntry) -> dict:
    paid_by_name = None
    if payment.paid_by_user:
        paid_by_name = payment.paid_by_user.name
    elif payment.collected_by:
        paid_by_name = payment.collected_by

    return {
        "id": payment.id,
        "collection_id": payment.collection_id,
        "amount": payment.amount,
        "method": payment.method,
        "created_by": payment.created_by,
        "created_at": payment.created_at,
        "collected_by": payment.collected_by,
        "collected_at": payment.collected_at,
        "transaction_ref": payment.transaction_ref,
        "proof_image": payment.proof_image,
        "status": payment.status,
        "verified_by": payment.verified_by,
        "verified_at": payment.verified_at,
        "receipt_id": payment.receipt_id,
        "purpose": payment.purpose,
        "head_id": payment.head_id,
        "payer_name": payment.head.name if payment.head else payment.collected_by,
        "address": payment.head.address if payment.head else None,
        "paid_by_user_id": payment.paid_by_user_id,
        "paid_by_name": paid_by_name,
        "months_covered": payment.months_covered or 0,
        "covered_months": payment.covered_months or [],
        "coverage_map": payment.coverage_map or {},
    }


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/", response_model=list[schemas.PaymentOut])
def get_payments(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    payments = db.query(models.PaymentEntry).options(
        joinedload(models.PaymentEntry.head),
        joinedload(models.PaymentEntry.paid_by_user),
    ).order_by(
        models.PaymentEntry.created_at.desc()
    ).all()

    return [_payment_to_dict(p) for p in payments]


@router.get("/pending")
def get_pending_payments(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Return all user-submitted payments awaiting verification."""
    payments = (
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
    return [_payment_to_dict(p) for p in payments]


@router.get("/summary")
def payment_summary(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    payments = db.query(models.PaymentEntry).all()

    total_amount = sum(p.amount for p in payments)
    cash_total = sum(p.amount for p in payments if (p.method or "").strip().lower() == "cash")
    upi_total = sum(p.amount for p in payments if (p.method or "").strip().lower() == "upi")
    verified_total = sum(p.amount for p in payments if p.status == "verified")
    pending_total = sum(p.amount for p in payments if p.status == "pending")
    rejected_total = sum(p.amount for p in payments if p.status == "rejected")

    return {
        "total_payments": len(payments),
        "total_amount": round(total_amount, 2),
        "cash_total": round(cash_total, 2),
        "upi_total": round(upi_total, 2),
        "verified_total": round(verified_total, 2),
        "pending_total": round(pending_total, 2),
        "rejected_total": round(rejected_total, 2),
    }
