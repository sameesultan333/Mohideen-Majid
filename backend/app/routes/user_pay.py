from datetime import datetime

import os

import shutil

from typing import Optional

import uuid



from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile

from sqlalchemy import or_

from sqlalchemy.orm import Session, joinedload



from app import models, schemas

from app.database import SessionLocal

from app.security import get_current_user

from app.utils.chanda_months import (
    current_month_key,
    pending_month_filter,
    visible_month_filter,
)
from app.utils.payment_ledger import build_coverage_map, generate_receipt_id

from app.utils.timezones import india_month_key, utc_now, utc_now_naive

from app.rate_limit import rate_limit

from app.websocket_manager import manager

from app.routes.finance import write_ledger

from app.utils.fcm import notify_role

from app.utils.payment_notify import notify_donation_payment



router = APIRouter(prefix="/user", tags=["User Payment"])





def get_db():

    db = SessionLocal()

    try:

        yield db

    finally:

        db.close()





UPLOAD_DIR = "uploads/payments"

if not os.path.exists(UPLOAD_DIR):

    os.makedirs(UPLOAD_DIR)





def _notify_admins_background(title: str, body: str, data: dict):

    """Runs after the response is sent, on its own DB session — the

    request-scoped session from get_db() is already closed by then."""

    bg_db = SessionLocal()

    try:

        notify_role(bg_db, ["admin", "superadmin"], title=title, body=body, data=data)

    finally:

        bg_db.close()





def normalize_phone(phone: Optional[str]) -> str:

    digits = "".join(filter(str.isdigit, str(phone or "")))

    if digits.startswith("00"):

        digits = digits[2:]

    if len(digits) >= 12 and digits.startswith("91"):

        digits = digits[2:]

    elif len(digits) == 11 and digits.startswith("0"):

        digits = digits[1:]

    return digits[:10] if len(digits) >= 10 else digits





def resolve_db_user(db: Session, user: dict):

    db_user = None

    user_id = user.get("sub")

    if user_id is not None:

        db_user = db.query(models.User).filter_by(id=user_id).first()

    if db_user:

        return db_user



    token_phone = normalize_phone(user.get("phone"))

    if token_phone:

        db_user = db.query(models.User).filter_by(phone=token_phone).first()

        if db_user:

            return db_user

        matches = db.query(models.User).filter(models.User.phone.like(f"%{token_phone}")).all()

        if len(matches) == 1:

            return matches[0]



    raise HTTPException(404, "User not found")





def resolve_user_head(db: Session, db_user, user: dict):

    # Prefer the stable family_id FK over phone-based lookup

    if db_user.family_id:

        head = db.query(models.ApprovedHead).filter_by(id=db_user.family_id).first()

        if head:

            return head



    # Legacy fallback: match by head_phone or own phone (for heads)

    candidate_phones = []

    for raw_phone in (

        db_user.head_phone,

        db_user.phone if db_user.role == "head" else None,

        user.get("phone"),

    ):

        phone = normalize_phone(raw_phone)

        if phone and phone not in candidate_phones:

            candidate_phones.append(phone)



    for phone in candidate_phones:

        head = db.query(models.ApprovedHead).filter_by(phone=phone).first()

        if head:

            return head

        matches = db.query(models.ApprovedHead).filter(

            models.ApprovedHead.phone.like(f"%{phone}")

        ).all()

        if len(matches) == 1:

            return matches[0]



    raise HTTPException(404, "Head not linked")





@router.post("/pay")

async def user_pay(

    request: Request,

    background_tasks: BackgroundTasks,

    amount: float = Form(...),

    purpose: str = Form(...),

    file: UploadFile = File(...),

    fund_id: Optional[int] = Form(None),

    db: Session = Depends(get_db),

    user: dict = Depends(get_current_user),

):

    await rate_limit(request, "donation")

    db_user = resolve_db_user(db, user)

    created_at = utc_now_naive()



    if purpose == "Monthly Chanda":

        head = resolve_user_head(db, db_user, user)

        # Try to allocate to generated months first

        coverage_map, unallocated = build_coverage_map(db, head, amount, None)

        if not coverage_map:

            # No generated months — create a collection for current month so

            # the payment can be held pending and admin can verify & allocate.

            current_month = india_month_key(utc_now())

            col = models.ChandaCollection(

                head_id=head.id,

                month=current_month,

                amount_due=head.monthly_amount or amount,

                total_paid=0,

                status="pending",

            )

            db.add(col)

            db.flush()

            coverage_map = {current_month: round(float(amount), 2)}

            unallocated = 0



        ext = (file.filename or "jpg").split(".")[-1]

        filename = f"{uuid.uuid4()}.{ext}"

        filepath = os.path.join(UPLOAD_DIR, filename)

        with open(filepath, "wb") as buffer:

            shutil.copyfileobj(file.file, buffer)



        payment = models.PaymentEntry(

            collection_id=None,

            head_id=head.id,

            paid_by_user_id=db_user.id,

            amount=amount,

            method="upi",

            created_at=created_at,

            collected_by=db_user.name,

            collected_at=None,

            proof_image=filepath,

            transaction_ref=None,

            status="pending",

            created_by="user",

            purpose=purpose,

            receipt_id=generate_receipt_id(db, prefix="CH", created_at=created_at),

            months_covered=len(coverage_map),

            covered_months=list(coverage_map.keys()),

            coverage_map=coverage_map,

        )



        db.add(payment)

        # Ledger entry written in verify_payment when admin confirms the UPI screenshot

        db.commit()

        db.refresh(payment)

        manager.publish_sync("finance", "payment_collected", {

            "payment_id": payment.id, "head_id": head.id, "created_by": "user",

        })

        # Separate event so admin notification bell increments immediately

        manager.publish_sync("finance", "payment_pending", {

            "payment_id": payment.id,

            "head_name": head.name,

            "amount": float(payment.amount),

            "paid_by": db_user.name,

        })

        # Backgrounded — FCM calls to every admin device must never add

        # latency to the payment response (this was the main contributor

        # to intermittent "Failed to submit" timeouts on Self Pay).

        background_tasks.add_task(

            _notify_admins_background,

            title="💰 New Payment Submitted",

            body=f"{db_user.name} submitted ₹{float(amount):.0f} — pending approval.",

            data={"type": "payment_pending", "payment_id": str(payment.id)},

        )

        if payment.receipt_id:

            manager.broadcast_sync(

                f"receipt:{payment.receipt_id}",

                {

                    "type": "receipt_update",

                    "payload": schemas.PaymentOut.model_validate(payment).model_dump(exclude_none=True),

                },

            )

        return {

            "message": "Payment submitted",

            "payment_id": payment.id,

            "status": payment.status,

            "receipt_id": payment.receipt_id,

            "covered_months": payment.covered_months or [],

            "months_covered": payment.months_covered or 0,

        }



    ext = (file.filename or "jpg").split(".")[-1]

    filename = f"{uuid.uuid4()}.{ext}"

    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as buffer:

        shutil.copyfileobj(file.file, buffer)



    # Validate fund if provided

    resolved_fund_id = None

    if fund_id is not None:

        fund_obj = db.query(models.Fund).filter_by(id=fund_id, is_archived=False).first()

        if fund_obj and fund_obj.status != "archived":

            resolved_fund_id = fund_obj.id



    donation = models.Donation(

        donor_name=db_user.name,

        user_id=db_user.id,

        amount=amount,

        method="upi",

        note=purpose,

        recorded_by=db_user.name,

        created_at=created_at,

        receipt_id=generate_receipt_id(db, prefix="DN", created_at=created_at),

        fund_id=resolved_fund_id,

        donor_type="app_user",

        receipt_image=filepath,

    )



    db.add(donation)

    db.flush()

    write_ledger(

        db, "donation", "income", amount,

        donation_id=donation.id,

        note=f"User UPI donation by {db_user.name}",

        created_by_id=db_user.id,

    )

    db.commit()

    db.refresh(donation)

    manager.publish_sync("finance", "donation_created", {"donation_id": donation.id, "user_id": db_user.id})

    background_tasks.add_task(

        _notify_admins_background,

        title="🎁 New Donation Received",

        body=f"{db_user.name} contributed ₹{float(amount):.0f}"

             + (f" to {fund_obj.name}." if resolved_fund_id and fund_obj else "."),

        data={"type": "donation_created", "donation_id": str(donation.id)},

    )

    notify_donation_payment(db, donation)

    return {

        "message": "Donation submitted",

        "donation_id": donation.id,

        "receipt_id": donation.receipt_id,

        "status": "verified",

    }





@router.get("/family")

def get_user_family(

    db: Session = Depends(get_db),

    user: dict = Depends(get_current_user),

):

    """Return the logged-in user's family head info + all family members."""

    db_user = resolve_db_user(db, user)

    try:

        head = resolve_user_head(db, db_user, user)

    except Exception:

        return {"chanda_no": None, "address": None, "head_name": None, "members": []}



    # All registered users in this family

    members = (

        db.query(models.User)

        .filter(models.User.family_id == head.id, models.User.is_active == True)

        .order_by(models.User.role, models.User.name)

        .all()

    )

    return {

        "chanda_no": head.chanda_no,

        "address": head.address,

        "head_name": head.name,

        "head_phone": head.phone,

        "members": [

            {

                "id": m.id,

                "name": m.name,

                "phone": m.phone,

                "role": m.role,

            }

            for m in members

        ],

    }





@router.get("/chanda/unpaid")

def get_unpaid_months(

    db: Session = Depends(get_db),

    user=Depends(get_current_user),

):

    db_user = resolve_db_user(db, user)

    try:

        head = resolve_user_head(db, db_user, user)

    except HTTPException:

        return []   # collector / staff users have no linked family head

    current_month = india_month_key(utc_now())

    # Only generated months can be unpaid — see utils/chanda_months.
    cols = (

        db.query(models.ChandaCollection)

        .filter(

            models.ChandaCollection.head_id == head.id,

            models.ChandaCollection.status.in_(["pending", "partial"]),

            models.ChandaCollection.month <= current_month,

            pending_month_filter(),
        )

        .order_by(models.ChandaCollection.month.asc())

        .all()

    )

    return [

        {

            "month": c.month,

            "amount_due": c.amount_due,

            "total_paid": c.total_paid,

            "balance": round(max(c.amount_due - c.total_paid, 0), 2),

            "status": c.status,

        }

        for c in cols

    ]





@router.get("/chanda/current")

def get_current_chanda(

    db: Session = Depends(get_db),

    user=Depends(get_current_user),

):

    db_user = resolve_db_user(db, user)

    try:

        head = resolve_user_head(db, db_user, user)

    except HTTPException:

        return {"status": "no_head", "amount_due": 0, "balance": 0, "paid_months": 0, "pending_months": 0}

    month = india_month_key(utc_now())

    all_cols = db.query(models.ChandaCollection).filter_by(head_id=head.id).all()

    # Only count generated months (ChandaCollection records that exist)

    # Filter to months <= current month to avoid counting future ungenerated months

    visible_cols = [c for c in all_cols if (c.month or "") <= month]

    paid_months = sum(1 for c in visible_cols if c.status == "paid")

    pending_months = sum(1 for c in visible_cols if c.status != "paid")



    # Check if current month collection exists

    collection = next((_c for c in all_cols if c.month == month), None)

    collection = next((c for c in all_cols if c.month == month), None)
    if not collection:

        # Month not yet generated — return family's configured rate so

        # the member can still pay and admin will allocate on verification.

        monthly = head.monthly_amount or 0

        return {

            "head_id": head.id,

            "head_name": head.name,

            "month": month,

            "amount_due": monthly,

            "total_paid": 0,

            "balance": monthly,

            "status": "not_generated",

            "monthly_amount": monthly,

            "paid_months": paid_months,

            "pending_months": pending_months,

            "chanda_no": head.chanda_no,

            "address": head.address,

        }



    amount_due = collection.amount_due

    total_paid = collection.total_paid

    balance = max(amount_due - total_paid, 0)



    return {

        "head_id": head.id,

        "head_name": head.name,

        "month": month,

        "amount_due": amount_due,

        "total_paid": total_paid,

        "balance": balance,

        "status": collection.status,

        "monthly_amount": amount_due,

        "paid_months": paid_months,

        "pending_months": pending_months,

        "chanda_no": head.chanda_no,

        "address": head.address,

    }





@router.get("/chanda-summary")

def get_user_chanda_summary(

    db: Session = Depends(get_db),

    user=Depends(get_current_user),

):

    """Lightweight endpoint: returns pending chanda month count for the badge.

    Only counts generated ChandaCollection records (months that exist in DB).

    """

    db_user = resolve_db_user(db, user)

    try:

        head = resolve_user_head(db, db_user, user)

    except HTTPException:

        return {"pending_months": 0, "head_linked": False}

    current_month = india_month_key(utc_now())

    # Only count generated months that exist in ChandaCollection table

    # Filter to months <= current month to avoid counting future ungenerated months

    pending = (

        db.query(models.ChandaCollection)

        .filter(

            models.ChandaCollection.head_id == head.id,

            models.ChandaCollection.status != "paid",

            models.ChandaCollection.month <= current_month,

            pending_month_filter(),
        )

        .count()

    )

    return {"pending_months": pending, "head_linked": True}





@router.get("/payments")

def get_user_payments(

    db: Session = Depends(get_db),

    user=Depends(get_current_user),

):

    db_user = resolve_db_user(db, user)

    try:

        head = resolve_user_head(db, db_user, user)

    except HTTPException:

        head = None



    payment_items = []

    if head:

        payments = (

            db.query(models.PaymentEntry)

            .options(joinedload(models.PaymentEntry.head))

            .filter(models.PaymentEntry.head_id == head.id)

            .order_by(models.PaymentEntry.created_at.desc())

            .all()

        )

        payment_items = [

            {

                "id": payment.id,

                "collection_id": payment.collection_id,

                "amount": payment.amount,

                "method": payment.method or "upi",

                "created_by": payment.created_by or "user",

                "created_at": payment.created_at,

                "collected_by": payment.collected_by,

                "collected_at": payment.collected_at,

                "transaction_ref": payment.transaction_ref,

                "proof_image": payment.proof_image,

                "status": payment.status,

                "verified_by": payment.verified_by,

                "verified_at": payment.verified_at,

                "receipt_id": payment.receipt_id,

                "purpose": payment.purpose or "Monthly Chanda",

                "head_id": payment.head_id,

                "payer_name": payment.head.name if payment.head else head.name,

                "address": head.address,

                "months_covered": payment.months_covered or 0,

                "covered_months": payment.covered_months or [],

                "coverage_map": payment.coverage_map or {},

            }

            for payment in payments

        ]



    # Include donations recorded directly by the user AND donations a collector/

    # admin recorded against this user's family head — both are "their" history.

    donation_filter = models.Donation.user_id == db_user.id

    if head:

        donation_filter = or_(donation_filter, models.Donation.head_id == head.id)



    donations = (

        db.query(models.Donation)

        .filter(donation_filter)

        .order_by(models.Donation.created_at.desc())

        .all()

    )



    donation_items = [

        {

            "id": donation.id,

            "collection_id": 0,

            "amount": donation.amount,

            "method": donation.method or "upi",

            "created_by": "user",

            "created_at": donation.created_at,

            "collected_by": donation.recorded_by,

            "collected_at": None,

            "transaction_ref": None,

            "proof_image": None,

            "status": "verified",

            "verified_by": donation.recorded_by,

            "verified_at": donation.created_at,

            "receipt_id": donation.receipt_id,

            "purpose": donation.note or "Donation",

            "head_id": donation.head_id,

            "payer_name": donation.donor_name or db_user.name,

            "address": head.address if head else db_user.address,

            "months_covered": 0,

            "covered_months": [],

            "coverage_map": {},

        }

        for donation in donations

    ]



    items = payment_items + donation_items

    items.sort(key=lambda item: item["created_at"] or datetime.min, reverse=True)

    return items

