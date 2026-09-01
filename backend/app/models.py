# backend/app/models.py

import enum
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, Float,
    ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.database import Base


# ─────────────────────────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────────────────────────

class UserStatus(str, enum.Enum):
    IMPORTED         = "IMPORTED"           # exists in DB from Excel, never registered
    PENDING_APPROVAL = "PENDING_APPROVAL"   # self-registered, awaiting admin approval
    ACTIVE           = "ACTIVE"             # approved and can use the app
    REJECTED         = "REJECTED"           # admin rejected the registration
    DISABLED         = "DISABLED"           # previously active, now disabled

class CashSubmissionStatus(str, enum.Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


# ─────────────────────────────────────────────────────────────
# FAMILY (APPROVED HEAD)
# ─────────────────────────────────────────────────────────────

class ApprovedHead(Base):
    __tablename__ = "approved_heads"

    id               = Column(Integer, primary_key=True, index=True)
    chanda_no        = Column(String, unique=True, index=True, nullable=False)
    name             = Column(String, nullable=False)
    # phone is nullable — imported families may not have a phone yet
    phone            = Column(String, nullable=True, index=True)
    address          = Column(String, nullable=True)
    zone             = Column(String, nullable=True)
    street           = Column(String, nullable=True, index=True)
    monthly_amount   = Column(Float, default=300, nullable=False)
    is_registered    = Column(Boolean, default=False)
    is_active        = Column(Boolean, default=True)
    registration_date = Column(DateTime, nullable=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=True)
    # assigned collector for this family
    collector_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    # Deactivation / 30-day restore window / permanent archive.
    # Row is NEVER physically deleted — is_deleted just hides it everywhere
    # while ChandaCollection/PaymentEntry history keeps resolving against it.
    deactivated_at      = Column(DateTime, nullable=True)
    deactivated_until   = Column(DateTime, nullable=True)
    deactivated_by_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
    deactivation_reason = Column(Text, nullable=True)
    is_deleted          = Column(Boolean, default=False, nullable=False)
    deleted_at          = Column(DateTime, nullable=True)

    collections = relationship("ChandaCollection", back_populates="head", cascade="all, delete-orphan")
    payments    = relationship("PaymentEntry",      back_populates="head",  foreign_keys="PaymentEntry.head_id")


# ─────────────────────────────────────────────────────────────
# USER ROLES (many-to-many, one row per user/role pair)
# ─────────────────────────────────────────────────────────────

class UserRoleEntry(Base):
    __tablename__ = "user_roles"

    user_id        = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role           = Column(String(30), primary_key=True)
    assigned_at    = Column(DateTime, default=datetime.utcnow, nullable=False)
    assigned_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


# ─────────────────────────────────────────────────────────────
# USER / AUTH
# ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id             = Column(Integer, primary_key=True, index=True)
    name           = Column(String, nullable=False)
    phone          = Column(String, unique=True, index=True, nullable=False)
    password            = Column(String, nullable=True)        # bcrypt hash — never plaintext
    role                = Column(String, nullable=False)
    family_id           = Column(Integer, ForeignKey("approved_heads.id"), nullable=True, index=True)
    head_phone          = Column(String, nullable=True)
    address             = Column(String, nullable=True)
    expo_token          = Column(String, nullable=True)
    is_active           = Column(Boolean, default=True)
    phone_verified      = Column(Boolean, default=True)
    is_registered       = Column(Boolean, default=False, nullable=False)
    registered_at       = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, nullable=True)
    failed_login_count  = Column(Integer, default=0, nullable=False)
    locked_until        = Column(DateTime, nullable=True)
    last_login          = Column(DateTime, nullable=True)
    invitation_created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    invitation_created_at = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Lifecycle status — single source of truth; is_active stays in sync for backward compat
    status          = Column(String(30), nullable=False, default=UserStatus.ACTIVE, index=True)
    rejection_reason = Column(Text, nullable=True)
    admin_notes     = Column(Text, nullable=True)
    approved_by_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at     = Column(DateTime, nullable=True)
    # Security: admin-reset passwords require user to set a new one on next login
    must_change_password = Column(Boolean, default=False, nullable=False)

    # Self-service account deletion (soft delete — never physically removed,
    # so payment/donation/audit history linked to this user id stays intact)
    is_deleted      = Column(Boolean, nullable=False, default=False)
    deleted_at      = Column(DateTime, nullable=True)
    deletion_reason = Column(Text, nullable=True)

    questions = relationship("Question",  back_populates="asker")
    donations = relationship("Donation",  back_populates="donor_user", foreign_keys="Donation.user_id")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_token_hash = Column(String(255), nullable=False, unique=True, index=True)
    device_name        = Column(String, nullable=True)
    browser            = Column(String, nullable=True)
    platform           = Column(String, nullable=True)
    ip_address         = Column(String, nullable=True)
    user_agent         = Column(Text, nullable=True)
    login_type         = Column(String(32), nullable=True)
    created_at         = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at       = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at         = Column(DateTime, nullable=False)
    is_active          = Column(Boolean, default=True, nullable=False)
    revoked_at         = Column(DateTime, nullable=True)

    user = relationship("User", backref="sessions")


# ─────────────────────────────────────────────────────────────
# FCM DEVICE TOKENS
# ─────────────────────────────────────────────────────────────

class DeviceToken(Base):
    __tablename__ = "device_tokens"
    # devices.py's register-device upsert does
    # ON CONFLICT (user_id, token) DO UPDATE — that requires this exact
    # composite unique constraint to exist, or every registration call
    # fails at the database level with "no unique or exclusion constraint
    # matching the ON CONFLICT specification".
    __table_args__ = (
        UniqueConstraint("user_id", "token", name="uq_device_token_user_token"),
    )

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token        = Column(String, nullable=False, index=True)
    platform     = Column(String(10), nullable=False)          # android | ios | web
    device_name  = Column(String, nullable=True)
    app_version  = Column(String, nullable=True)
    is_active    = Column(Boolean, default=True, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="device_tokens")


# ─────────────────────────────────────────────────────────────
# FUND (CAMPAIGN)
# ─────────────────────────────────────────────────────────────

class Fund(Base):
    __tablename__ = "funds"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String(200), nullable=False, unique=True)
    description      = Column(Text, nullable=True)
    goal_amount      = Column(Float, nullable=True)
    start_date       = Column(DateTime, nullable=True)
    expected_end_date = Column(DateTime, nullable=True)
    completed_at     = Column(DateTime, nullable=True)
    status           = Column(String(20), default="active", nullable=False, index=True)  # draft|active|completed|archived
    is_active        = Column(Boolean, default=True, nullable=False)
    is_archived      = Column(Boolean, default=False, nullable=False)
    created_by       = Column(String, nullable=True)
    created_by_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    archived_at      = Column(DateTime, nullable=True)
    archived_by      = Column(String, nullable=True)

    donations = relationship("Donation", back_populates="fund_rel", foreign_keys="Donation.fund_id")
    expenses  = relationship("Expense",  back_populates="fund_rel", foreign_keys="Expense.fund_id")
    creator   = relationship("User", foreign_keys=[created_by_id])


# ─────────────────────────────────────────────────────────────
# DONATION PURPOSE
# ─────────────────────────────────────────────────────────────

class DonationPurpose(Base):
    __tablename__ = "donation_purposes"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False, unique=True)
    description   = Column(Text, nullable=True)
    target_amount = Column(Float, nullable=True)
    is_active     = Column(Boolean, default=True)
    is_archived   = Column(Boolean, default=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    donations = relationship("Donation", back_populates="purpose_rel")


# ─────────────────────────────────────────────────────────────
# DONATIONS
# ─────────────────────────────────────────────────────────────

class Donation(Base):
    __tablename__ = "donations"

    id            = Column(Integer, primary_key=True, index=True)
    donor_name    = Column(String, nullable=False)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    head_id       = Column(Integer, ForeignKey("approved_heads.id"), nullable=True)
    member_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    purpose_id    = Column(Integer, ForeignKey("donation_purposes.id"), nullable=True)
    fund_id       = Column(Integer, ForeignKey("funds.id"), nullable=True, index=True)
    amount        = Column(Float, nullable=False)
    method        = Column(String, default="cash")   # cash|upi|bank|cheque
    donor_type    = Column(String(20), default="walk_in", nullable=True)  # app_user|member|walk_in|anonymous
    phone         = Column(String, nullable=True)
    chanda_no     = Column(String, nullable=True)
    donation_date = Column(DateTime, nullable=True)
    receipt_image = Column(String, nullable=True)
    note          = Column(Text, nullable=True)
    receipt_id    = Column(String, unique=True, nullable=True)
    recorded_by   = Column(String, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Cash-submission tracking — which collector physically collected this,
    # and which submission (if any) it has been bundled/locked into.
    collector_id  = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    submission_id = Column(Integer, ForeignKey("collector_cash_submissions.id"), nullable=True, index=True)

    donor_user  = relationship("User",            back_populates="donations", foreign_keys=[user_id])
    purpose_rel = relationship("DonationPurpose", back_populates="donations")
    fund_rel    = relationship("Fund",            back_populates="donations", foreign_keys=[fund_id])


# ─────────────────────────────────────────────────────────────
# CHANDA COLLECTION + PAYMENT
# ─────────────────────────────────────────────────────────────

class ChandaCollection(Base):
    __tablename__ = "chanda_collections"
    __table_args__ = (
        # One row per family per month, enforced at the DB level. Without
        # this, two gunicorn workers both running job_generate_chanda_month
        # at 00:05 on the 1st of the month (APScheduler starts in every
        # worker process - see main.py's startup handler - with no leader
        # election) could both check "does head X have a row for this
        # month?", both get "no" in the same race window, and both insert -
        # producing a real duplicate row that silently doubled that family's
        # amount_due in every dashboard/collector total. This is what
        # actually happened for 62 of 439 families in September's generation.
        UniqueConstraint("head_id", "month", name="uq_chanda_collection_head_month"),
    )

    id                 = Column(Integer, primary_key=True, index=True)
    head_id            = Column(Integer, ForeignKey("approved_heads.id"), nullable=True, index=True)
    month              = Column(String, index=True)          # "YYYY-MM"
    amount_due         = Column(Float, nullable=False)
    total_paid         = Column(Float, default=0)
    status             = Column(String, default="pending", index=True)   # pending | paid
    is_advance         = Column(Boolean, default=False)       # True when paid via advance from a prior month
    advance_payment_id = Column(Integer, ForeignKey("payment_entries.id"), nullable=True)
    rate_snapshot      = Column(Float, nullable=True)          # head.monthly_amount at time of generation
    created_at         = Column(DateTime, default=datetime.utcnow)

    head     = relationship("ApprovedHead", back_populates="collections")
    payments = relationship("PaymentEntry", back_populates="collection", foreign_keys="PaymentEntry.collection_id")


class PaymentEntry(Base):
    __tablename__ = "payment_entries"

    id              = Column(Integer, primary_key=True, index=True)
    collection_id   = Column(Integer, ForeignKey("chanda_collections.id"), nullable=True)
    head_id         = Column(Integer, ForeignKey("approved_heads.id"), nullable=True, index=True)
    amount          = Column(Float, nullable=False)
    method          = Column(String, default="cash")
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)
    collected_by    = Column(String, nullable=True)
    collected_at    = Column(DateTime, nullable=True)
    transaction_ref = Column(String, nullable=True)
    proof_image     = Column(String, nullable=True)
    status          = Column(String, default="pending", index=True)   # pending | verified | rejected
    created_by      = Column(String, nullable=True)
    verified_by     = Column(String, nullable=True)
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at     = Column(DateTime, nullable=True)
    receipt_id      = Column(String, unique=True, nullable=True)
    purpose         = Column(String, default="Monthly Chanda")
    months_covered  = Column(Integer, default=0)
    covered_months  = Column(JSON, nullable=True)
    coverage_map    = Column(JSON, nullable=True)
    paid_by_user_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes                 = Column(Text, nullable=True)
    monthly_rate_snapshot = Column(Float, nullable=True)       # head.monthly_amount at time of collection
    gross_amount          = Column(Float, nullable=True)       # before discount
    discount_amount       = Column(Float, default=0, nullable=True)
    discount_reason       = Column(String, nullable=True)
    payment_token         = Column(String, unique=True, nullable=True)  # idempotency key
    payment_source        = Column(String, nullable=True, default="app")  # app | import
    receipt_status        = Column(String, nullable=True)  # active | historical_import
    rollback_status       = Column(String, nullable=True, default=None)  # pending | approved | rejected

    # Cash-submission tracking — which collector physically collected this,
    # and which submission (if any) it has been bundled/locked into.
    collector_id  = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    submission_id = Column(Integer, ForeignKey("collector_cash_submissions.id"), nullable=True, index=True)

    collection   = relationship("ChandaCollection", back_populates="payments", foreign_keys=[collection_id])
    head         = relationship("ApprovedHead", back_populates="payments", foreign_keys=[head_id])
    paid_by_user = relationship("User", foreign_keys=[paid_by_user_id])


# ─────────────────────────────────────────────────────────────
# EXPENSES
# ─────────────────────────────────────────────────────────────

class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    is_active   = Column(Boolean, default=True, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    expenses = relationship("Expense", back_populates="category_rel")


class Expense(Base):
    __tablename__ = "expenses"

    id              = Column(Integer, primary_key=True, index=True)
    title           = Column(String(255), nullable=False, index=True)
    amount          = Column(Float, nullable=False)
    # legacy plain-text category kept for backward compat; category_id is preferred
    category        = Column(String, nullable=True)
    category_id     = Column(Integer, ForeignKey("expense_categories.id"), nullable=True, index=True)
    fund_id         = Column(Integer, ForeignKey("funds.id"), nullable=True, index=True)
    vendor_name     = Column(String(200), nullable=True)
    expense_date    = Column(DateTime, nullable=True)
    note            = Column(Text, nullable=True)
    receipt_image   = Column(String, nullable=True)
    receipt_id      = Column(String, unique=True, nullable=True, index=True)
    created_by      = Column(String, nullable=True)
    created_by_id   = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    approved_by     = Column(String, nullable=True)
    approved_by_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at     = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # soft delete
    is_deleted      = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at      = Column(DateTime, nullable=True)
    deleted_by      = Column(String, nullable=True)

    category_rel = relationship("ExpenseCategory", back_populates="expenses")
    fund_rel     = relationship("Fund", back_populates="expenses", foreign_keys=[fund_id])


# ─────────────────────────────────────────────────────────────
# UNIFIED RECEIPT
# ─────────────────────────────────────────────────────────────

class PaymentRollbackRequest(Base):
    __tablename__ = "payment_rollback_requests"

    id                  = Column(Integer, primary_key=True, index=True)
    payment_entry_id    = Column(Integer, ForeignKey("payment_entries.id"), nullable=False, index=True)
    requested_by_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    requested_at        = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    reason              = Column(Text, nullable=True)
    status              = Column(String, nullable=False, default="pending", index=True)  # pending | approved | rejected
    approved_by_id      = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    approved_at         = Column(DateTime, nullable=True)
    decision_note       = Column(Text, nullable=True)
    original_amount     = Column(Float, nullable=True)
    original_receipt_id = Column(String, nullable=True)
    original_covered_months = Column(JSON, nullable=True)
    payment_source      = Column(String, nullable=True)

    payment_entry = relationship("PaymentEntry", foreign_keys=[payment_entry_id])
    requested_by  = relationship("User", foreign_keys=[requested_by_id])
    approved_by   = relationship("User", foreign_keys=[approved_by_id])


class AdminActivity(Base):
    """
    Persistent "an admin should know this happened" log - deliberately
    separate from the self-registration approval flow (User.status ==
    PENDING_APPROVAL / RegistrationApprovalService), which is unchanged and
    NOT stored here. Two activity_type values today:

      "family_added"      - a Collector/Admin created a family directly.
        The family is already fully active the moment it's created; this is
        only awareness, never a gate. See admin.py/collector.py create_family.
      "user_deactivated"  - an Admin deactivated a family or disabled a user
        account. The deactivation already happened through its own existing
        flow (deactivate_family / staff remove-role / status toggle); this
        is only a record that it happened, never a second copy of that state.

    Acknowledging a row is NEVER an approval and NEVER reverses or alters the
    underlying family/user - it only records acknowledged_by/acknowledged_at
    and drops off the unacknowledged list. Superseded FamilyAcknowledgement
    table (single-purpose predecessor of this one) was never deployed to
    production, so this replaces it outright rather than migrating it.
    """
    __tablename__ = "admin_activities"

    id               = Column(Integer, primary_key=True, index=True)
    activity_type    = Column(String, nullable=False, index=True)  # "family_added" | "user_deactivated"

    # Subject of the activity - whichever of these applies is set, the other left null.
    head_id          = Column(Integer, ForeignKey("approved_heads.id"), nullable=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Denormalized display fields so this row is still readable even if the
    # subject is later hard-deleted (family/staff hard-delete both exist).
    subject_name     = Column(String, nullable=True)
    subject_phone    = Column(String, nullable=True)
    subject_chanda_no = Column(String, nullable=True)
    reason           = Column(Text, nullable=True)  # e.g. deactivation reason

    performed_by_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
    performed_by_name = Column(String, nullable=True)
    performed_by_role = Column(String, nullable=True)  # "collector" | "admin" | "superadmin"
    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    acknowledged         = Column(Boolean, default=False, nullable=False, index=True)
    acknowledged_by_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_by_name = Column(String, nullable=True)
    acknowledged_at      = Column(DateTime, nullable=True)

    head            = relationship("ApprovedHead", foreign_keys=[head_id])
    subject_user    = relationship("User", foreign_keys=[user_id])
    performed_by    = relationship("User", foreign_keys=[performed_by_id])
    acknowledged_by = relationship("User", foreign_keys=[acknowledged_by_id])


class Receipt(Base):
    """
    Unified receipt table — one row per issued receipt.
    Join to the source table using (transaction_type, transaction_id):
      chanda   → payment_entries.id
      donation → donations.id
      expense  → expenses.id
    """
    __tablename__ = "receipts"

    id               = Column(Integer, primary_key=True, index=True)
    receipt_number   = Column(String, unique=True, index=True, nullable=False)
    transaction_type = Column(String, nullable=False, index=True)   # chanda | donation | expense
    transaction_id   = Column(Integer, nullable=False, index=True)  # PK in the source table
    amount           = Column(Float, nullable=False)
    family_id        = Column(Integer, ForeignKey("approved_heads.id"), nullable=True)
    issued_by_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes            = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    family    = relationship("ApprovedHead", foreign_keys=[family_id])
    issued_by = relationship("User",         foreign_keys=[issued_by_id])


# ─────────────────────────────────────────────────────────────
# FINANCE LEDGER
# ─────────────────────────────────────────────────────────────

class FinanceTransaction(Base):
    __tablename__ = "finance_transactions"

    id               = Column(Integer, primary_key=True, index=True)
    transaction_type = Column(String, nullable=False)   # chanda | donation | expense | adjustment | refund
    direction        = Column(String, nullable=False)   # income | expense
    amount           = Column(Float, nullable=False)
    family_id        = Column(Integer, ForeignKey("approved_heads.id"), nullable=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=True)
    payment_entry_id = Column(Integer, ForeignKey("payment_entries.id"), nullable=True)
    donation_id      = Column(Integer, ForeignKey("donations.id"), nullable=True)
    expense_id       = Column(Integer, ForeignKey("expenses.id"), nullable=True)
    receipt_number   = Column(String, nullable=True)
    month            = Column(String, nullable=True)    # "YYYY-MM" when applicable
    note             = Column(Text, nullable=True)
    created_by_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, index=True)

    family       = relationship("ApprovedHead", foreign_keys=[family_id])
    created_by   = relationship("User",         foreign_keys=[created_by_id])


# ─────────────────────────────────────────────────────────────
# AUDIT LOG
# ─────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id                  = Column(Integer, primary_key=True, index=True)
    table_name          = Column(String, nullable=False)
    record_id           = Column(Integer, nullable=False)
    action              = Column(String, nullable=False, index=True)
    old_values          = Column(JSONB, nullable=True)
    new_values          = Column(JSONB, nullable=True)
    performed_by_id     = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    performed_at        = Column(DateTime, default=datetime.utcnow, index=True)
    ip_address          = Column(String, nullable=True)
    note                = Column(Text, nullable=True)

    # Enhanced enterprise fields
    module              = Column(String(50), nullable=True, index=True)
    action_label        = Column(String(100), nullable=True)
    user_role           = Column(String(30), nullable=True, index=True)
    user_fullname       = Column(String(200), nullable=True)
    description         = Column(Text, nullable=True)
    browser             = Column(String(100), nullable=True)
    os_name             = Column(String(100), nullable=True)
    device_name         = Column(String(200), nullable=True)
    session_id          = Column(Integer, nullable=True)
    request_id          = Column(String(36), nullable=True)
    endpoint            = Column(String(300), nullable=True)
    http_method         = Column(String(10), nullable=True)
    status              = Column(String(20), nullable=True, default="success", index=True)
    failure_reason      = Column(Text, nullable=True)
    execution_time_ms   = Column(Integer, nullable=True)
    affected_record_type = Column(String(100), nullable=True)

    performed_by = relationship("User", foreign_keys=[performed_by_id])


# ─────────────────────────────────────────────────────────────
# FINANCE SETTINGS (key-value store)
# ─────────────────────────────────────────────────────────────

class FinanceSetting(Base):
    __tablename__ = "finance_settings"

    id             = Column(Integer, primary_key=True, index=True)
    key            = Column(String, unique=True, nullable=False)
    value          = Column(Text, nullable=True)
    updated_by_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# RELIGIOUS CONTENT
# ─────────────────────────────────────────────────────────────

class PrayerTiming(Base):
    __tablename__ = "prayer_timings"

    id = Column(Integer, primary_key=True, index=True)

    # Early
    imsak = Column(String, nullable=False)
    sunrise = Column(String, nullable=False)
    dhuha = Column(String, nullable=False)

    # Adhan
    fajr_adhan = Column(String, nullable=False)
    dhuhr_adhan = Column(String, nullable=False)
    asr_adhan = Column(String, nullable=False)
    maghrib_adhan = Column(String, nullable=False)
    isha_adhan = Column(String, nullable=False)
    jummah_iqamah = Column(String)
    # Iqamah / Prayer
    fajr = Column(String, nullable=False)
    dhuhr = Column(String, nullable=False)
    asr = Column(String, nullable=False)
    maghrib = Column(String, nullable=False)
    isha = Column(String, nullable=False)
    jummah = Column(String, nullable=False)

    # Special
    taraweeh = Column(String, nullable=True)
    ishraq = Column(String, nullable=True)
    sunset = Column(String, nullable=False)

    # Optional Notes
    notes = Column(String, nullable=True)

    # Version — incremented on every save so phones can detect changes cheaply
    schedule_version = Column(Integer, default=1, nullable=False)

    # Audit
    updated_by = Column(String, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class Announcement(Base):
    __tablename__ = "announcements"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    pinned = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    posted_by = Column(String, nullable=False)
    image_url = Column(String, nullable=True)
    audio_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    # NULL = broadcast to everyone; set to a user id for a private/targeted message
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Who posted it. posted_by keeps the display name as written at the time;
    # this resolves the author's role without guessing it from that name.
    # Nullable because announcements posted before this column existed have no
    # author link - they simply show no role.
    posted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    posted_by_user = relationship("User", foreign_keys=[posted_by_user_id])

    @property
    def posted_by_role(self) -> str | None:
        """The author's current role, straight off their user record."""
        author = self.posted_by_user
        return author.role if author else None


class Hadith(Base):
    __tablename__ = "hadiths"

    id          = Column(Integer, primary_key=True, index=True)
    arabic      = Column(Text, nullable=True)
    translation = Column(Text, nullable=False)
    source      = Column(String, nullable=True)
    posted_by   = Column(String, nullable=False)
    date        = Column(String, nullable=True)
    voice_url   = Column(String, nullable=True)
    image_url   = Column(String, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"

    id                  = Column(Integer, primary_key=True, index=True)
    question_text       = Column(Text, nullable=False)
    question_voice_url  = Column(String, nullable=True)
    user_id             = Column(Integer, ForeignKey("users.id"), index=True)
    status              = Column(String, default="pending", index=True)
    is_active           = Column(Boolean, default=False, index=True)
    created_at          = Column(DateTime, default=datetime.utcnow)

    asker   = relationship("User",   back_populates="questions")
    answers = relationship("Answer", back_populates="question")


class Answer(Base):
    __tablename__ = "answers"

    id               = Column(Integer, primary_key=True, index=True)
    question_id      = Column(Integer, ForeignKey("questions.id"))
    answer_text      = Column(Text, nullable=True)
    answer_voice_url = Column(String, nullable=True)
    answered_by      = Column(Integer, ForeignKey("users.id"))
    answer_image_url = Column(String, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    question = relationship("Question", back_populates="answers")


class Reply(Base):
    __tablename__ = "replies"

    id              = Column(Integer, primary_key=True, index=True)
    hadith_id       = Column(Integer, ForeignKey("hadiths.id"), index=True)
    text            = Column(Text, nullable=False)
    parent_reply_id = Column(Integer, ForeignKey("replies.id"), nullable=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), index=True)
    created_at      = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# SMS QUEUE
# ─────────────────────────────────────────────────────────────

class SmsQueue(Base):
    __tablename__ = "sms_queue"

    id           = Column(Integer, primary_key=True, index=True)
    phone        = Column(String, nullable=False, index=True)
    message      = Column(Text, nullable=False)
    template_id  = Column(String, nullable=True)   # MSG91 template id if applicable
    status       = Column(String, default="pending", index=True)  # pending | sent | failed
    attempts     = Column(Integer, default=0)
    last_error   = Column(Text, nullable=True)
    scheduled_at = Column(DateTime, default=datetime.utcnow, index=True)
    sent_at      = Column(DateTime, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


# ─────────────────────────────────────────────────────────────
# COLLECTOR CASH SUBMISSION
# Collector physically collects cash and submits to admin.
# Approval/rejection fields live on this same row (no separate
# approvals table — the audit log captures the full history).
# ─────────────────────────────────────────────────────────────

class CollectorCashSubmission(Base):
    __tablename__ = "collector_cash_submissions"

    id                   = Column(Integer, primary_key=True, index=True)
    collector_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    start_date           = Column(DateTime, nullable=False)
    end_date             = Column(DateTime, nullable=False)

    # Financial fields — always server-computed from the underlying
    # Donation / PaymentEntry rows included in this submission, never typed
    # in by the collector.
    submitted_amount     = Column(Numeric(12, 2), nullable=False)  # cash_amount + online_amount
    cash_amount          = Column(Numeric(12, 2), nullable=True)   # cash-method total
    online_amount        = Column(Numeric(12, 2), nullable=True)   # GPay/UPI/online-method total
    categories            = Column(JSON, nullable=True)            # e.g. ["chanda", "donation"]
    expected_amount      = Column(Numeric(12, 2), nullable=True)   # admin's expected total (optional)
    approved_amount      = Column(Numeric(12, 2), nullable=True)   # confirmed on approval

    receiving_admin_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes                = Column(Text, nullable=True)

    # Workflow
    status               = Column(String(20), nullable=False, default=CashSubmissionStatus.PENDING, index=True)
    rejection_reason     = Column(Text, nullable=True)

    # Approval audit — who and when
    approved_by_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at          = Column(DateTime, nullable=True)
    rejected_by_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    rejected_at          = Column(DateTime, nullable=True)

    submitted_at         = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at           = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at           = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    collector       = relationship("User", foreign_keys=[collector_id])
    receiving_admin = relationship("User", foreign_keys=[receiving_admin_id])
    approved_by     = relationship("User", foreign_keys=[approved_by_id])
    rejected_by     = relationship("User", foreign_keys=[rejected_by_id])
    donations        = relationship("Donation", foreign_keys="Donation.submission_id")
    payment_entries  = relationship("PaymentEntry", foreign_keys="PaymentEntry.submission_id")
