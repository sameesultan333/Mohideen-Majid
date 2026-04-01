# backend/app/routes/admin.py

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
import pandas as pd
from app.security import require_admin, require_superadmin
from app.database import SessionLocal
from app import models,schemas
from app.security import require_admin


router = APIRouter(prefix="/admin", tags=["Admin"])


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
# ✅ NORMALIZE PHONE
# ─────────────────────────────────────────────────────────────
def normalize(phone):
    return ''.join(filter(str.isdigit, str(phone)))


# ─────────────────────────────────────────────────────────────
# 📊 UPLOAD APPROVED HEADS (EXCEL)
# ─────────────────────────────────────────────────────────────
@router.post("/upload-heads")
def upload_heads(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    #admin=Depends(require_admin)  # 🔐 PROTECTED
):
    try:
        # ── Read file ─────────────────────────────
        if file.filename.endswith(".csv"):
            df = pd.read_csv(file.file)
        else:
            df = pd.read_excel(file.file)

        # ── CLEAN COLUMN NAMES (IMPORTANT FIX) ──
        df.columns = df.columns.str.strip().str.lower()

        print("COLUMNS:", df.columns.tolist())  # debug

    except Exception as e:
        raise HTTPException(400, f"Invalid file: {str(e)}")

    # ── REQUIRED COLUMNS ────────────────────────
    required = {"name", "phone", "address"}
    missing = required - set(df.columns)

    if missing:
        raise HTTPException(400, f"Missing columns: {missing}")

    inserted = 0
    skipped = 0

    # ── PROCESS ROWS ───────────────────────────
    for _, row in df.iterrows():

        name = str(row["name"]).strip()
        phone = normalize(row["phone"])
        address = str(row.get("address", "")).strip()

        # skip invalid phone
        if not phone:
            skipped += 1
            continue

        # check duplicate
        exists = db.query(models.ApprovedHead).filter_by(phone=phone).first()
        if exists:
            skipped += 1
            continue

        # insert
        new_head = models.ApprovedHead(
            name=name,
            phone=phone,
            address=address
        )

        db.add(new_head)
        inserted += 1

    db.commit()

    return {
        "message": "Upload completed",
        "inserted": inserted,
        "skipped": skipped
    }

# ─────────────────────────────────────────────────────────────
# 👨‍💼 CREATE ADMIN / IMAM
# ─────────────────────────────────────────────────────────────
@router.post("/create-staff")
def create_staff(
    data: schemas.CreateStaff,
    db: Session = Depends(get_db),
    current_user=Depends(require_superadmin)  # 🔐 ONLY YOU
):
    phone = ''.join(filter(str.isdigit, data.phone))

    # ❌ prevent duplicate
    existing = db.query(models.User).filter_by(phone=phone).first()
    if existing:
        raise HTTPException(400, "User already exists")

    # ❌ only allow admin/imam
    if data.role not in ["admin", "imam"]:
        raise HTTPException(400, "Invalid role")

    from app.security import hash_password

    user = models.User(
        name=data.name,
        phone=phone,
        password=hash_password(data.password),
        role=data.role,
        head_phone=phone  # required field
    )

    db.add(user)
    db.commit()

    return {"message": f"{data.role} created successfully"}