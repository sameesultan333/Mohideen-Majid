# backend/app/security.py

import os
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import hashlib
import secrets
from fastapi import Response
from sqlalchemy.orm import Session
from app import models
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
load_dotenv()
from fastapi.security import HTTPBearer
# ─────────────────────────────────────────────────────────────
# ✅ CONFIG (SECURE)
# ─────────────────────────────────────────────────────────────

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set. Refusing to start.")
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60
MOBILE_SESSION_DAYS  = int(os.getenv("MOBILE_SESSION_DAYS", "40"))
ADMIN_SESSION_DAYS   = int(os.getenv("ADMIN_SESSION_DAYS", "10"))
MAX_SESSIONS_PER_USER = 5
REFRESH_COOKIE_NAME = "refresh_token"
ACCESS_COOKIE_NAME = "access_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")


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
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        # Corrupt or unrecognised hash in the DB — treat as wrong password,
        # never crash the server. Logged implicitly via the failed-attempt counter.
        return False


# ─────────────────────────────────────────────────────────────
# ✅ JWT CREATION
# ─────────────────────────────────────────────────────────────
def create_access_token(
    user_id: int,
    role: str,
    session_id: int,
    status: str = "ACTIVE",
    name: str | None = None,
    must_change_password: bool = False,
    roles: list[str] | None = None,
) -> str:
    """Creates a short-lived JWT access token.

    `role`  — primary role (backwards-compat field; highest-privilege role).
    `roles` — full list of all roles this user holds (for multi-role RBAC).
              Falls back to [role] when not supplied.
    """
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "roles": roles if roles is not None else [role],
        "session_id": session_id,
        "status": status,
        "name": name,
        "must_change_password": must_change_password,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ─────────────────────────────────────────────────────────────
# ✅ SESSION MANAGEMENT
# ─────────────────────────────────────────────────────────────

def _session_platform(login_type: str | None) -> str:
    """admin_login is the only web-dashboard login_type — everything else
    (login, *_register, password_change) is the mobile app."""
    return "web" if login_type == "admin_login" else "mobile"


def create_user_session(
    db: Session,
    user_id: int,
    refresh_token: str,
    device_name=None,
    browser=None,
    platform=None,
    ip_address=None,
    user_agent=None,
    login_type=None,
    session_days: int = None,
) -> models.UserSession:
    # Enforce max concurrent sessions PER PLATFORM — revoke oldest if over the
    # limit. Web and mobile used to share one pool, so repeatedly logging into
    # the admin dashboard could silently evict a still-in-use mobile session
    # (and vice versa) for the same account. Each platform now gets its own
    # 5-session budget.
    this_platform = _session_platform(login_type)
    active_sessions = (
        db.query(models.UserSession)
        .filter_by(user_id=user_id, is_active=True)
        .order_by(models.UserSession.last_used_at.asc())
        .all()
    )
    active_same_platform = [s for s in active_sessions if _session_platform(s.login_type) == this_platform]
    if len(active_same_platform) >= MAX_SESSIONS_PER_USER:
        oldest = active_same_platform[0]
        oldest.is_active = False
        oldest.revoked_at = datetime.utcnow()
        db.flush()

    days = session_days if session_days is not None else MOBILE_SESSION_DAYS
    session = models.UserSession(
        user_id=user_id,
        refresh_token_hash=hash_refresh_token(refresh_token),
        device_name=device_name,
        browser=browser,
        platform=platform,
        ip_address=ip_address,
        user_agent=user_agent,
        login_type=login_type,
        expires_at=datetime.utcnow() + timedelta(days=days),
        last_used_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, refresh_token: str) -> models.UserSession:
    token_hash = hash_refresh_token(refresh_token)
    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.refresh_token_hash == token_hash)
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")
    if not session.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
    if session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
    if session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return session


def rotate_session(db: Session, session: models.UserSession, session_days: int = None) -> str:
    days = session_days if session_days is not None else MOBILE_SESSION_DAYS
    new_token = create_refresh_token()
    session.refresh_token_hash = hash_refresh_token(new_token)
    session.last_used_at = datetime.utcnow()
    session.expires_at = datetime.utcnow() + timedelta(days=days)
    db.commit()
    db.refresh(session)
    return new_token


def revoke_session(db: Session, session: models.UserSession) -> None:
    session.is_active = False
    session.revoked_at = datetime.utcnow()
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    now = datetime.utcnow()
    db.query(models.UserSession).filter(
        models.UserSession.user_id == user_id,
        models.UserSession.is_active == True,
    ).update({"is_active": False, "revoked_at": now})
    db.commit()


# ─────────────────────────────────────────────────────────────
# ✅ COOKIE HELPERS
# ─────────────────────────────────────────────────────────────

# The admin dashboard and API are deployed as separate Render services on
# different origins (e.g. admindashboard-8x0p.onrender.com vs
# mohideen-majid.onrender.com). A SameSite=Lax cookie is NEVER sent by the
# browser on a cross-origin XHR/fetch request — only on top-level navigation.
# POST /auth/refresh is an XHR call, so with Lax the refresh cookie silently
# never reaches the server: login works (same-request Set-Cookie), but the
# very next page reload's refresh call gets no cookie at all, 401s, and
# ProtectedRoute redirects to /login even though the session is still valid.
# SameSite=None is the only setting that works cross-origin, and browsers
# require Secure=true whenever SameSite=None is used — which we already have
# in production (COOKIE_SECURE=true). Locally (COOKIE_SECURE=false, same
# origin via the Vite proxy) Lax is fine and is kept as-is.
def _effective_samesite() -> str:
    return "none" if COOKIE_SECURE else COOKIE_SAMESITE


def set_refresh_cookie(response: Response, refresh_token: str, max_age_days: int = None) -> None:
    days = max_age_days if max_age_days is not None else MOBILE_SESSION_DAYS
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=_effective_samesite(),
        path="/",
        max_age=days * 86400,
        expires=days * 86400,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/", samesite=_effective_samesite())


# ─────────────────────────────────────────────────────────────
# ✅ JWT DECODE + VALIDATION
# ─────────────────────────────────────────────────────────────
def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        if not payload.get("sub"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
        if payload.get("session_id") is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing session_id")
        if payload.get("role") is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing role")

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

def _effective_roles(current_user: dict) -> set[str]:
    """Return the full set of roles from the JWT payload.

    New tokens carry a `roles` list.  Old tokens only have a single `role`
    string — we fall back gracefully so no token ever gets hard-rejected
    just because it was issued before the multi-role migration.
    """
    roles: list[str] = current_user.get("roles") or []
    primary: str = current_user.get("role") or ""
    combined = set(roles)
    if primary:
        combined.add(primary)
    return combined


def _has_any(current_user: dict, *allowed: str) -> bool:
    return bool(_effective_roles(current_user) & set(allowed))


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not _has_any(current_user, "admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_superadmin(current_user: dict = Depends(get_current_user)) -> dict:
    if not _has_any(current_user, "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin access required")
    return current_user


def require_admin_or_imam(current_user: dict = Depends(get_current_user)) -> dict:
    if not _has_any(current_user, "superadmin", "admin", "imam"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return current_user


def require_prayer_editor(current_user: dict = Depends(get_current_user)) -> dict:
    """Prayer times specifically also let watchman/modhin (the staff roles
    that typically enter adhan times day-to-day) edit — a wider allowlist
    than require_admin_or_imam, which is shared by announcements/hadith/
    questions and shouldn't be broadened just for this one endpoint."""
    if not _has_any(current_user, "superadmin", "admin", "imam", "watchman", "modhin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Prayer management access required")
    return current_user


def require_collector(current_user: dict = Depends(get_current_user)) -> dict:
    if not _has_any(current_user, "collector", "admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collector access required")
    return current_user


def require_admin_or_collector(current_user: dict = Depends(get_current_user)) -> dict:
    if not _has_any(current_user, "admin", "superadmin", "collector"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or collector access required")
    return current_user


def require_active_user(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Centralized lifecycle gate. Must be used on every route that requires
    a fully active account. Pending/rejected/disabled users are blocked here
    rather than with scattered checks throughout route files.
    """
    user_status = current_user.get("status", "ACTIVE")
    if user_status == "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending approval by the mosque administrator.",
        )
    if user_status == "REJECTED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your registration was rejected. Please contact the mosque administrator.",
        )
    if user_status in ("DISABLED", "IMPORTED"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please contact the mosque administrator.",
        )
    return current_user


# Rate limiting is handled by app/rate_limit.py (Redis-backed).
# See rate_limit.rate_limit() and rate_limit_phone() for usage.