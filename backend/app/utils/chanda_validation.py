"""
ChandaCollection data consistency validation utilities.

These functions detect data inconsistencies where ChandaCollection records
should exist but are missing (e.g., due to failed generation, data corruption,
or partial imports). They report inconsistencies rather than silently treating
families as not pending.
"""

from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app import models
from app.utils.timezones import india_month_key, utc_now, add_months


def detect_missing_collections_for_head(
    db: Session,
    head_id: int,
    start_month: str | None = None,
    end_month: str | None = None,
) -> List[Dict[str, Any]]:
    """
    Detect missing ChandaCollection records for a specific family head.
    
    Args:
        db: Database session
        head_id: Family head ID
        start_month: Optional start month (YYYY-MM). If None, uses registration_date
        end_month: Optional end month (YYYY-MM). If None, uses current month
    
    Returns:
        List of dictionaries with missing month information
    """
    head = db.query(models.ApprovedHead).filter_by(id=head_id).first()
    if not head:
        return []
    
    current_month = india_month_key(utc_now())
    end_month = end_month or current_month
    
    # Determine start month from registration_date or created_at
    if start_month is None:
        start_dt = head.registration_date or head.created_at
        if start_dt:
            start_month = india_month_key(start_dt)
        else:
            start_month = current_month
    
    # Get existing ChandaCollection months for this head
    existing_months = {
        month
        for (month,) in db.query(models.ChandaCollection.month)
        .filter(models.ChandaCollection.head_id == head_id)
        .all()
    }
    
    # Check for missing months in the expected range
    missing = []
    cursor = start_month
    while cursor <= end_month:
        if cursor not in existing_months:
            missing.append({
                "head_id": head_id,
                "head_name": head.name,
                "chanda_no": head.chanda_no,
                "missing_month": cursor,
                "expected_amount": head.monthly_amount or 0,
            })
        cursor = add_months(cursor, 1)
    
    return missing


def detect_all_missing_collections(
    db: Session,
    start_month: str | None = None,
    end_month: str | None = None,
) -> List[Dict[str, Any]]:
    """
    Detect missing ChandaCollection records for all active families.
    
    Args:
        db: Database session
        start_month: Optional start month (YYYY-MM). If None, uses each head's registration_date
        end_month: Optional end month (YYYY-MM). If None, uses current month
    
    Returns:
        List of dictionaries with missing month information for all heads
    """
    current_month = india_month_key(utc_now())
    end_month = end_month or current_month
    
    # Get all active heads
    heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
    
    all_missing = []
    for head in heads:
        # Use head-specific start month if not provided globally
        head_start = start_month
        if head_start is None:
            start_dt = head.registration_date or head.created_at
            if start_dt:
                head_start = india_month_key(start_dt)
            else:
                head_start = current_month
        
        head_missing = detect_missing_collections_for_head(
            db, head.id, head_start, end_month
        )
        all_missing.extend(head_missing)
    
    return all_missing


def detect_payment_without_collection(
    db: Session,
) -> List[Dict[str, Any]]:
    """
    Detect PaymentEntry records that reference non-existent ChandaCollection records.
    This can happen if a payment was recorded but the month generation failed.
    
    Args:
        db: Database session
    
    Returns:
        List of dictionaries with payment information that has no matching collection
    """
    # Get all verified payments that have a collection_id
    payments = (
        db.query(models.PaymentEntry)
        .filter(
            models.PaymentEntry.status == "verified",
            models.PaymentEntry.collection_id.isnot(None),
        )
        .all()
    )
    
    missing = []
    for payment in payments:
        if payment.collection_id:
            collection = db.query(models.ChandaCollection).filter_by(
                id=payment.collection_id
            ).first()
            if not collection:
                head = db.query(models.ApprovedHead).filter_by(
                    id=payment.head_id
                ).first()
                missing.append({
                    "payment_id": payment.id,
                    "head_id": payment.head_id,
                    "head_name": head.name if head else "Unknown",
                    "chanda_no": head.chanda_no if head else "Unknown",
                    "missing_collection_id": payment.collection_id,
                    "payment_amount": payment.amount,
                    "payment_month": payment.covered_months[0] if payment.covered_months else "Unknown",
                    "payment_date": payment.created_at,
                })
    
    return missing


def validate_chanda_consistency(
    db: Session,
) -> Dict[str, Any]:
    """
    Run comprehensive consistency checks on ChandaCollection data.
    
    Args:
        db: Database session
    
    Returns:
        Dictionary with consistency report
    """
    missing_collections = detect_all_missing_collections(db)
    orphaned_payments = detect_payment_without_collection(db)
    
    return {
        "missing_collections": {
            "count": len(missing_collections),
            "items": missing_collections,
        },
        "orphaned_payments": {
            "count": len(orphaned_payments),
            "items": orphaned_payments,
        },
        "has_inconsistencies": len(missing_collections) > 0 or len(orphaned_payments) > 0,
    }
