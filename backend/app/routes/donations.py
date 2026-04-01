# backend/app/routes/donations.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models, schemas
from app.security import require_admin, require_superadmin

router = APIRouter(prefix="/donations", tags=["Donations"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── GET all donations — admin/superadmin only ─────────────────────────────────
@router.get("/", response_model=list[schemas.DonationOut])
def get_donations(
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return db.query(models.Donation).order_by(
        models.Donation.created_at.desc()
    ).all()


# ── GET summary — admin/superadmin only ──────────────────────────────────────
@router.get("/summary")
def donation_summary(
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    all_donations = db.query(models.Donation).all()

    total = sum(
        float(d.amount)
        for d in all_donations
        if d.amount.replace(".", "").isdigit()
    )

    return {
        "total_donations": len(all_donations),
        "total_amount":    round(total, 2),
    }


# ── ADD donation — admin/superadmin only ──────────────────────────────────────
@router.post("/", response_model=schemas.DonationOut, status_code=201)
def add_donation(
    data: schemas.DonationCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    donation = models.Donation(
        donor_name=data.donor_name,
        amount=data.amount,
        method=data.method,
        note=data.note,
        recorded_by=user["name"],
    )
    db.add(donation)
    db.commit()
    db.refresh(donation)
    return donation


# ── DELETE donation — superadmin only ────────────────────────────────────────
@router.delete("/{donation_id}")
def delete_donation(
    donation_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    d = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Donation not found")

    db.delete(d)
    db.commit()
    return {"message": "Donation deleted"}