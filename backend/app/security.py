# backend/app/security.py

import os
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
load_dotenv()
from fastapi.security import HTTPBearer
# ─────────────────────────────────────────────────────────────
# ✅ CONFIG (SECURE)
# ─────────────────────────────────────────────────────────────

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 30   # 🔐 short-lived token
REFRESH_TOKEN_EXPIRE_DAYS = 7      # (future use)


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# tokenUrl should match your login endpoint
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
security = HTTPBearer()

# ─────────────────────────────────────────────────────────────
# ✅ PASSWORD
# ─────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ─────────────────────────────────────────────────────────────
# ✅ JWT CREATION
# ─────────────────────────────────────────────────────────────
def create_access_token(data: dict) -> str:
    payload = data.copy()

    payload.update({
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": datetime.utcnow(),
        "type": "access"
    })

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ─────────────────────────────────────────────────────────────
# ✅ JWT DECODE + VALIDATION
# ─────────────────────────────────────────────────────────────
def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        # basic structure validation
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )

        return payload

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ─────────────────────────────────────────────────────────────
# ✅ CURRENT USER
# ─────────────────────────────────────────────────────────────
def get_current_user(token=Depends(security)):
    return decode_token(token.credentials)


# ─────────────────────────────────────────────────────────────
# ✅ ROLE-BASED ACCESS CONTROL
# ─────────────────────────────────────────────────────────────
def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


def require_superadmin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required"
        )
    return current_user


def require_admin_or_imam(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ("superadmin", "admin", "imam"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff access required"
        )
    return current_user


# ─────────────────────────────────────────────────────────────
# ✅ OPTIONAL: RATE LIMIT HELPER (BASIC)
# ─────────────────────────────────────────────────────────────
login_attempts = {}

def check_login_attempts(phone: str):
    now = datetime.utcnow()

    attempts = login_attempts.get(phone, [])

    # keep only last 5 minutes
    attempts = [t for t in attempts if now - t < timedelta(minutes=5)]

    if len(attempts) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again later."
        )

    attempts.append(now)
    login_attempts[phone] = attempts