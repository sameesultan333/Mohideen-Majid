# backend/app/routes/auth.py

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import SessionLocal
from app.models import UserStatus
from app.rate_limit import rate_limit, rate_limit_phone, clear_rate_limit
from app.security import (
    MOBILE_SESSION_DAYS,
    ADMIN_SESSION_DAYS,
    create_access_token,
    create_refresh_token,
    create_user_session,
    get_session,
    rotate_session,
    revoke_session,
    revoke_all_sessions,
    set_refresh_cookie,
    clear_refresh_cookie,
    get_current_user,
    hash_password,
    verify_password,
    REFRESH_COOKIE_NAME,
)
from app.services.audit_service import AuditAction, log_action
from app.websocket_manager import manager
from app.routes.devices import deactivate_all_tokens_for_user

router = APIRouter(prefix="/auth", tags=["Auth"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize_phone(phone: str) -> str:
    digits = "".join(filter(str.isdigit, phone))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) >= 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits[:10] if len(digits) >= 10 else digits


def _get_user_roles(db: Session, user: models.User) -> list[str]:
    """Load all roles from the user_roles table.
    Falls back to [user.role] if the table is empty or missing entries
    (e.g. legacy accounts that pre-date the migration).
    """
    rows = db.query(models.UserRoleEntry).filter_by(user_id=user.id).all()
    if rows:
        return [r.role for r in rows]
    return [user.role] if user.role else []


def _ensure_role_entry(db: Session, user_id: int, role: str, assigned_by_id: int | None = None) -> None:
    """Add a role to user_roles if not already present (idempotent)."""
    exists = db.query(models.UserRoleEntry).filter_by(user_id=user_id, role=role).first()
    if not exists:
        db.add(models.UserRoleEntry(user_id=user_id, role=role, assigned_by_id=assigned_by_id))
        db.flush()


def _issue_tokens(
    db: Session,
    response: Response,
    request: Request,
    user: models.User,
    login_type: str,
    session_days: int = None,
) -> dict:
    days = session_days if session_days is not None else MOBILE_SESSION_DAYS
    refresh_token = create_refresh_token()
    session = create_user_session(
        db,
        user_id=user.id,
        refresh_token=refresh_token,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        login_type=login_type,
        session_days=days,
    )
    user_status = user.status or UserStatus.ACTIVE
    all_roles = _get_user_roles(db, user)
    access_token = create_access_token(
        user_id=user.id,
        role=user.role,
        session_id=session.id,
        status=user_status,
        name=user.name,
        must_change_password=bool(getattr(user, "must_change_password", False)),
        roles=all_roles,
    )
    set_refresh_cookie(response, refresh_token, max_age_days=days)
    user.last_login = datetime.utcnow()
    db.commit()
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id":        user.id,
            "name":      user.name,
            "phone":     user.phone,
            "role":      user.role,
            "roles":     all_roles,
            "family_id": user.family_id,
            "status":    user_status,
        },
    }


_ADMIN_ROLES = {"superadmin", "admin"}


def _authenticate_user(db: Session, phone: str, password: str) -> models.User:
    """
    Shared credential check for /login and /admin-login.
    Handles normalization, lock enforcement, failed-count tracking.
    PENDING_APPROVAL users CAN authenticate — the status restriction
    happens at the route level so they get a valid (restricted) token.
    """
    phone = normalize_phone(phone)
    user = db.query(models.User).filter_by(phone=phone).first()

    _invalid = HTTPException(401, "Invalid phone number or password.")

    if not user or not user.password or not user.is_registered:
        raise _invalid

    # Deleted accounts can never authenticate again, checked before password
    # verification so it fails fast (same ordering as the disabled/rejected checks below)
    if user.is_deleted:
        raise HTTPException(403, "This account has been deleted.")

    # Only block truly disabled accounts here; pending users get through
    if user.status == UserStatus.DISABLED:
        raise HTTPException(403, "Account disabled. Contact your mosque administrator.")
    if user.status == UserStatus.REJECTED:
        raise HTTPException(403, "Your registration was rejected. Contact the mosque administrator.")
    if not user.is_active and user.status not in (UserStatus.PENDING_APPROVAL,):
        raise HTTPException(403, "Account is not active.")

    if user.locked_until and datetime.utcnow() < user.locked_until:
        remaining = max(1, int((user.locked_until - datetime.utcnow()).total_seconds() / 60) + 1)
        raise HTTPException(
            403,
            f"Too many failed attempts. Account locked for {remaining} minute{'s' if remaining > 1 else ''}.",
        )

    if not verify_password(password, user.password):
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= 5:
            user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            user.failed_login_count = 0
        db.commit()
        raise _invalid

    user.failed_login_count = 0
    user.locked_until = None
    return user


# ── REGISTER ──────────────────────────────────────────────────────────────────

@router.post("/register", response_model=schemas.TokenResponse)
async def register(
    data: schemas.RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    await rate_limit(request, "register")
    if len(data.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if data.password != data.confirm_password:
        raise HTTPException(400, "Passwords do not match.")

    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number.")

    existing = db.query(models.User).filter_by(phone=phone).first()

    # Case A: already fully registered with a password
    if existing and existing.is_registered and existing.password:
        raise HTTPException(400, "Already registered. Please login.")

    # Case B: user row exists but no password yet (staff pre-created / OTP migrated)
    if existing:
        existing.password = hash_password(data.password)
        existing.is_registered = True
        existing.registered_at = datetime.utcnow()
        existing.is_active = True
        if not existing.status or existing.status == UserStatus.IMPORTED:
            existing.status = UserStatus.ACTIVE
        _ensure_role_entry(db, existing.id, existing.role)
        login_type = "staff_register" if existing.role in ("staff", "admin", "superadmin", "imam") else "register"
        result = _issue_tokens(db, response, request, existing, login_type, MOBILE_SESSION_DAYS)
        await log_action(db, AuditAction.USER_REGISTERED, "users", existing.id,
                         request=request, description=f"Password setup for existing user {existing.name}")
        db.commit()
        return result

    # Case C: phone matches an imported approved head that hasn't been claimed yet — immediately ACTIVE
    # Skip if the user is explicitly registering as a member (head_phone provided) — go to Case D instead
    head = db.query(models.ApprovedHead).filter_by(phone=phone).first() if not data.head_phone else None
    if head and not head.user_id:
        user = models.User(
            name=head.name,
            phone=phone,
            role="head",
            family_id=head.id,
            head_phone=phone,
            password=hash_password(data.password),
            is_registered=True,
            registered_at=datetime.utcnow(),
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
        head.is_registered = True
        head.user_id = user.id
        _ensure_role_entry(db, user.id, "head")
        result = _issue_tokens(db, response, request, user, "head_register", MOBILE_SESSION_DAYS)
        await log_action(db, AuditAction.USER_REGISTERED, "users", user.id,
                         request=request, description=f"Head registration: {user.name}")
        db.commit()
        return result

    # Case D: member registration using head_phone
    if data.head_phone:
        head_phone = normalize_phone(data.head_phone)
        head = db.query(models.ApprovedHead).filter_by(phone=head_phone).first()
        if not head:
            raise HTTPException(400, "Family head not found. Contact your mosque administrator.")
        if not head.is_registered:
            raise HTTPException(400, "Family head has not registered yet.")
        name = (data.name or "").strip()
        if not name:
            raise HTTPException(400, "Name is required for member registration.")
        user = models.User(
            name=name,
            phone=phone,
            role="member",
            head_phone=head_phone,
            family_id=head.id,
            password=hash_password(data.password),
            is_registered=True,
            registered_at=datetime.utcnow(),
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
        _ensure_role_entry(db, user.id, "member")
        result = _issue_tokens(db, response, request, user, "member_register", MOBILE_SESSION_DAYS)
        await log_action(db, AuditAction.USER_REGISTERED, "users", user.id,
                         request=request, description=f"Member registration: {user.name}")
        db.commit()
        return result

    # Case E: brand-new person — PENDING_APPROVAL
    # They are auto-logged in but see only the pending screen
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Full name is required for new registration.")

    new_user = models.User(
        name=name,
        phone=phone,
        address=getattr(data, "address", None) or None,
        role="head",          # default role; admin can change on approval
        password=hash_password(data.password),
        is_registered=True,
        registered_at=datetime.utcnow(),
        is_active=True,       # account is active but status gates access
        status=UserStatus.PENDING_APPROVAL,
    )
    db.add(new_user)
    db.flush()
    _ensure_role_entry(db, new_user.id, new_user.role)
    result = _issue_tokens(db, response, request, new_user, "new_register", MOBILE_SESSION_DAYS)
    await log_action(db, AuditAction.USER_REGISTERED, "users", new_user.id,
                     request=request, description=f"New self-registration pending approval: {name}")
    db.commit()
    # Admins previously only found out about a new pending registration via a
    # 60s poll (fetchBadgeCounts in NotificationContext) — nothing pushed this
    # live over the websocket like payments/donations/expenses already do.
    manager.publish_sync("admin", "registration_pending", {"user_id": new_user.id, "name": new_user.name})
    # Signal to the frontend that this user needs approval
    result["pending_approval"] = True
    return result


# ── LOGIN (mobile) ────────────────────────────────────────────────────────────

@router.post("/login")
async def login(
    data: schemas.LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    await rate_limit_phone(request, "login", data.phone)
    phone = normalize_phone(data.phone)

    user = _authenticate_user(db, data.phone, data.password)

    result = _issue_tokens(db, response, request, user, "login", MOBILE_SESSION_DAYS)
    await log_action(db, AuditAction.USER_LOGIN, "users", user.id,
                     actor={"sub": str(user.id), "role": user.role, "name": user.name},
                     request=request, description=f"Login: {user.name}")
    await clear_rate_limit("login", request, phone[-4:] if phone else "")
    db.commit()
    return result


# ── ADMIN LOGIN (web dashboard) ───────────────────────────────────────────────

@router.post("/admin-login")
async def admin_login(
    data: schemas.LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    await rate_limit_phone(request, "login", data.phone)
    phone = normalize_phone(data.phone)

    user = _authenticate_user(db, data.phone, data.password)

    if user.role not in _ADMIN_ROLES:
        raise HTTPException(403, "Access denied. Admin accounts only.")

    result = _issue_tokens(db, response, request, user, "admin_login", ADMIN_SESSION_DAYS)
    await log_action(db, AuditAction.ADMIN_LOGIN, "users", user.id,
                     actor={"sub": str(user.id), "role": user.role, "name": user.name},
                     request=request, description=f"Admin login: {user.name} ({user.role})")
    await clear_rate_limit("login", request, phone[-4:] if phone else "")
    db.commit()
    return {
        "access_token": result["access_token"],
        "token_type": "bearer",
        "user": result["user"],
    }


# ── CHANGE PASSWORD ───────────────────────────────────────────────────────────

@router.post("/change-password")
async def change_password(
    data: schemas.ChangePasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await rate_limit(request, "change_password")
    user = db.query(models.User).filter_by(id=int(current_user["sub"])).first()
    if not user:
        raise HTTPException(404, "User not found.")

    if not user.password or not verify_password(data.current_password, user.password):
        raise HTTPException(400, "Current password is incorrect.")
    if len(data.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters.")
    if data.new_password != data.confirm_new_password:
        raise HTTPException(400, "Passwords do not match.")

    user.password = hash_password(data.new_password)
    user.password_changed_at = datetime.utcnow()
    user.must_change_password = False
    revoke_all_sessions(db, user.id)

    result = _issue_tokens(db, response, request, user, "password_change", MOBILE_SESSION_DAYS)
    await log_action(db, AuditAction.PASSWORD_CHANGED, "users", user.id,
                     actor=current_user, request=request,
                     description=f"Password changed: {user.name}")
    db.commit()
    return {"message": "Password changed successfully.", **result}


# ── DELETE ACCOUNT (self-service, mobile app) ─────────────────────────────────

@router.post("/delete-account")
async def delete_account(
    data: schemas.ConfirmPassword,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Soft-deletes the caller's own account AND cascades: the linked family
    (ApprovedHead) is soft-deleted too — same is_deleted flag the 30-day
    archive job uses, so it vanishes from every list/count immediately
    instead of staying active until someone remembers to deactivate it
    separately — and every other registered User under that same family_id
    (spouse/children/other members) is soft-deleted and unlinked alongside it.
    Nothing is ever physically removed — payment/donation/audit history tied
    to these ids must keep resolving against them."""
    user = db.query(models.User).filter_by(id=int(current_user["sub"])).first()
    if not user:
        raise HTTPException(404, "User not found.")

    if user.role == "superadmin":
        raise HTTPException(403, "Superadmin accounts cannot be deleted.")

    if not user.password or not verify_password(data.password, user.password):
        raise HTTPException(401, "Incorrect password")

    family_id = user.family_id
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first() if family_id else None

    # Every other registered account under the same family — captured before
    # anything is modified so the family_id filter still matches.
    other_members = (
        db.query(models.User)
        .filter(models.User.family_id == family_id, models.User.id != user.id)
        .all()
        if family_id else []
    )

    def _soft_delete_user(u):
        u.is_deleted = True
        u.deleted_at = datetime.utcnow()
        u.deletion_reason = data.reason
        u.family_id = None
        u.is_active = False
        revoke_all_sessions(db, u.id)
        deactivate_all_tokens_for_user(db, u.id)
        u.expo_token = None

    _soft_delete_user(user)

    if head:
        head.user_id = None
        head.is_registered = False
        head.is_active = False
        head.is_deleted = True
        head.deleted_at = datetime.utcnow()

    for m in other_members:
        _soft_delete_user(m)

    await log_action(
        db, AuditAction.USER_ACCOUNT_DELETED, "users", user.id,
        actor=current_user, request=request,
        description=f"Account deleted by user: {user.name}" + (f" (chanda_no={head.chanda_no})" if head else ""),
        old_values={"is_deleted": False},
        new_values={
            "is_deleted": True,
            "reason": data.reason,
            "user_name": user.name,
            "chanda_no": head.chanda_no if head else None,
        },
    )
    if head:
        await log_action(
            db, AuditAction.FAMILY_ARCHIVED, "approved_heads", head.id,
            actor=current_user, request=request,
            description=f"Family {head.name} ({head.chanda_no}) archived — head deleted their own account"
                         + (f", {len(other_members)} other linked account(s) removed with it" if other_members else ""),
            new_values={"is_deleted": True, "is_active": False},
        )
    for m in other_members:
        await log_action(
            db, AuditAction.USER_ACCOUNT_DELETED, "users", m.id,
            actor=current_user, request=request,
            description=f"Account removed as part of family deletion (head: {user.name})",
            new_values={"is_deleted": True},
        )

    clear_refresh_cookie(response)
    db.commit()
    return {"message": "Account deleted"}


# ── HEAD LOOKUP ───────────────────────────────────────────────────────────────

@router.get("/head-lookup")
def head_lookup(phone: str, db: Session = Depends(get_db)):
    """Return approved head name for a given phone — used by register screen."""
    p = normalize_phone(phone)
    if not p:
        return {"found": False}
    head = db.query(models.ApprovedHead).filter_by(phone=p).first()
    if not head or head.is_registered:
        return {"found": False}
    return {"found": True, "name": head.name, "chanda_no": head.chanda_no}


# ── TOKEN REFRESH ─────────────────────────────────────────────────────────────

@router.post("/refresh")
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    token = request.cookies.get(REFRESH_COOKIE_NAME) or request.headers.get("X-Refresh-Token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")

    session = get_session(db, token)
    if not session:
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or invalid")

    user = db.query(models.User).filter_by(id=session.user_id).first()
    if not user:
        revoke_session(db, session)
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    # Disabled/rejected/deleted accounts cannot refresh
    if user.is_deleted:
        revoke_session(db, session)
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account has been deleted.")
    if user.status in (UserStatus.DISABLED, UserStatus.REJECTED):
        revoke_session(db, session)
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is not active")

    new_refresh = rotate_session(db, session, session_days=MOBILE_SESSION_DAYS)
    access_token = create_access_token(
        user_id=user.id, role=user.role, session_id=session.id,
        status=user.status or UserStatus.ACTIVE, name=user.name,
    )
    set_refresh_cookie(response, new_refresh, max_age_days=MOBILE_SESSION_DAYS)
    return {
        "access_token": access_token,
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "user": {
            "id": user.id, "name": user.name,
            "phone": user.phone, "role": user.role,
            "family_id": user.family_id, "status": user.status,
        },
    }


# ── LOGOUT ────────────────────────────────────────────────────────────────────

@router.get("/status")
def get_my_status(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Lightweight endpoint — returns the caller's live status from DB."""
    user = db.query(models.User).filter_by(id=int(current_user["sub"])).first()
    if not user:
        raise HTTPException(404, "User not found")
    return {"status": user.status, "name": user.name, "role": user.role}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        try:
            session = get_session(db, token)
            if session:
                user = db.query(models.User).filter_by(id=session.user_id).first()
                if user:
                    await log_action(db, AuditAction.USER_LOGOUT, "users", user.id,
                                     actor={"sub": str(user.id), "role": user.role, "name": user.name},
                                     request=request, description=f"Logout: {user.name}")
                revoke_session(db, session)
                db.commit()
        except Exception:
            pass
    clear_refresh_cookie(response)
    return {"message": "Logged out"}


@router.post("/logout-all")
def logout_all(
    response: Response,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = int(current_user["sub"])
    revoke_all_sessions(db, user_id)
    db.commit()
    clear_refresh_cookie(response)
    return {"message": "All sessions revoked"}


# ── SESSION MANAGEMENT ────────────────────────────────────────────────────────

@router.get("/sessions")
def list_sessions(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = int(current_user["sub"])
    sessions = (
        db.query(models.UserSession)
        .filter_by(user_id=user_id, is_active=True)
        .order_by(models.UserSession.last_used_at.desc())
        .all()
    )
    return [
        {
            "id":           s.id,
            "device_name":  s.device_name,
            "browser":      s.browser,
            "platform":     s.platform,
            "ip_address":   s.ip_address,
            "login_type":   s.login_type,
            "created_at":   s.created_at,
            "last_used_at": s.last_used_at,
            "expires_at":   s.expires_at,
        }
        for s in sessions
    ]


@router.delete("/sessions/{session_id}")
def revoke_one_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = int(current_user["sub"])
    session = db.query(models.UserSession).filter_by(
        id=session_id, user_id=user_id, is_active=True
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    revoke_session(db, session)
    db.commit()
    return {"message": "Session revoked"}


# ── ME ────────────────────────────────────────────────────────────────────────

@router.get("/me")
def me(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user = db.query(models.User).filter_by(id=int(current_user["sub"])).first()
    if not user:
        raise HTTPException(404, "User not found")
    return {
        "id":                   user.id,
        "name":                 user.name,
        "phone":                user.phone,
        "role":                 user.role,
        "roles":                _get_user_roles(db, user),
        "family_id":            user.family_id,
        "is_active":            user.is_active,
        "is_registered":        user.is_registered,
        "status":               user.status,
        "last_login":           user.last_login,
        "must_change_password": bool(user.must_change_password),
    }
