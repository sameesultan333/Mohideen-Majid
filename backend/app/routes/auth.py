# backend/app/routes/auth.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import random

from app.database import SessionLocal
from app import models, schemas
from app.security import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["Auth"])


# ─────────────────────────────────────────────────────────────
# ✅ DB DEPENDENCY
# ─────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────
# ✅ OTP STORE (DEV MODE)
# ─────────────────────────────────────────────────────────────
otp_store = {}  
# { phone: { otp, expires } }


def generate_otp():
    return str(random.randint(100000, 999999))


def normalize(phone: str):
    return ''.join(filter(str.isdigit, phone))


# ─────────────────────────────────────────────────────────────
# ✅ HEAD REGISTER
# ─────────────────────────────────────────────────────────────
@router.post("/register/head")
def register_head(data: schemas.HeadRegister, db: Session = Depends(get_db)):

    phone = normalize(data.phone)

    # check approved list
    approved = db.query(models.ApprovedHead).filter_by(phone=phone).first()
    if not approved:
        raise HTTPException(400, "You are not authorized as head")

    # prevent duplicate registration
    existing = db.query(models.User).filter_by(phone=phone).first()
    if existing:
        raise HTTPException(400, "Head already registered")

    # create user (use Excel data)
    user = models.User(
        name=approved.name,
        phone=phone,
        password=hash_password(data.password),
        role="head",
        head_phone=phone,
        address=approved.address
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    # update approved_heads
    approved.is_registered = True
    approved.user_id = user.id
    db.commit()

    return {"message": "Head registered successfully"}


# ─────────────────────────────────────────────────────────────
# ✅ MEMBER REGISTER
# ─────────────────────────────────────────────────────────────
@router.post("/register/member")
def register_member(data: schemas.MemberRegister, db: Session = Depends(get_db)):

    phone = normalize(data.phone)
    head_phone = normalize(data.head_phone)

    # prevent duplicate
    if db.query(models.User).filter_by(phone=phone).first():
        raise HTTPException(400, "User already exists")

    # check head exists in system
    head = db.query(models.User).filter(
        models.User.phone == head_phone,
        models.User.role == "head"
    ).first()

    if not head:
        raise HTTPException(400, "Head not registered. Contact family head.")

    # create member
    user = models.User(
        name=data.name,
        phone=phone,
        password=hash_password(data.password),
        role="member",
        head_phone=head_phone
    )

    db.add(user)
    db.commit()

    return {"message": "Member registered successfully"}


# ─────────────────────────────────────────────────────────────
# ✅ LOGIN (STEP 1: PASSWORD)
# ─────────────────────────────────────────────────────────────
@router.post("/login")
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):

    phone = normalize(data.phone)

    user = db.query(models.User).filter_by(phone=phone).first()

    if not user or not verify_password(data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone or password"
        )

    # generate OTP
    otp = generate_otp()

    otp_store[phone] = {
        "otp": otp,
        "expires": datetime.utcnow() + timedelta(minutes=2)
    }

    print(f"LOGIN OTP for {phone}: {otp}")  # dev only

    return {"message": "OTP sent"}


# ─────────────────────────────────────────────────────────────
# ✅ VERIFY LOGIN OTP (STEP 2)
# ─────────────────────────────────────────────────────────────
@router.post("/verify-login-otp")
def verify_login_otp(data: schemas.VerifyLoginOTP, db: Session = Depends(get_db)):

    phone = normalize(data.phone)

    record = otp_store.get(phone)

    if not record:
        raise HTTPException(400, "OTP not found")

    if record["expires"] < datetime.utcnow():
        raise HTTPException(400, "OTP expired")

    if record["otp"] != data.otp:
        raise HTTPException(400, "Invalid OTP")

    # remove OTP after use
    otp_store.pop(phone)

    user = db.query(models.User).filter_by(phone=phone).first()

    if not user:
        raise HTTPException(404, "User not found")

    # create JWT
    token = create_access_token({
        "sub": str(user.id),
        "role": user.role,
        "phone": user.phone
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "phone": user.phone,
            "role": user.role,
            "head_phone": user.head_phone
        }
    }