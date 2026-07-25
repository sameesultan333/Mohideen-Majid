# backend/app/schemas.py

from typing import Annotated, Optional, List, Literal

from pydantic import BaseModel, PlainSerializer
from datetime import datetime

# Every timestamp column in this app is written with datetime.utcnow() —
# naive (no tzinfo), but semantically always UTC. Pydantic v2 serializes a
# naive datetime via its own Rust core (bypassing FastAPI's jsonable_encoder
# entirely for response_model routes), producing an ISO string with no
# 'Z'/offset suffix — which browsers and RN's `new Date(...)` then
# misinterpret as already being in the viewer's local timezone, silently
# shifting every displayed timestamp by the viewer's UTC offset. Use this
# type instead of bare `datetime` on any response-model field so it's
# correctly marked as UTC on the wire.
UTCDateTime = Annotated[
    datetime,
    PlainSerializer(
        lambda dt: dt.isoformat() + "Z" if dt.tzinfo is None else dt.isoformat(),
        return_type=str,
    ),
]


# ─────────────────────────────────────────────
# 🔐 AUTH
# ─────────────────────────────────────────────
class RegisterRequest(BaseModel):
    phone: str
    password: str
    confirm_password: str
    name: Optional[str] = None       # required for member; required for new self-registrants (Case E)
    head_phone: Optional[str] = None # required for member registration
    address: Optional[str] = None    # optional; stored for new self-registrants pending approval


class LoginRequest(BaseModel):
    phone: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class ConfirmPassword(BaseModel):
    """Re-verify the ACTING admin's own current password before a sensitive,
    hard-to-reverse action (e.g. deactivating a family)."""
    password: str
    reason: Optional[str] = None


class AdminResetPasswordRequest(BaseModel):
    new_password: str = "12345678"


class UserBasic(BaseModel):
    id: int
    name: str
    phone: str
    role: str
    family_id: Optional[int] = None
    status: Optional[str] = None
    roles: Optional[list[str]] = None

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user: Optional[UserBasic] = None
    pending_approval: Optional[bool] = None


# ─────────────────────────────────────────────
# 👤 USER
# ─────────────────────────────────────────────
class UserOut(BaseModel):

    id: int
    name: str
    phone: str
    role: str
    family_id: Optional[int]
    head_phone: Optional[str]
    address: Optional[str]
    is_active: bool
    phone_verified: bool
    last_login: Optional[UTCDateTime]
    created_at: Optional[UTCDateTime]

    class Config:
        from_attributes = True

class CreateUser(BaseModel):
    name: str
    phone: str
    role: str
    head_phone: str
    address: str | None = None

class UpdateUser(BaseModel):
    name: str | None = None
    phone: str | None = None
    role: str | None = None
    address: str | None = None
    is_active: bool | None = None

# ─────────────────────────────────────────────
# 👥 STAFF
# ─────────────────────────────────────────────
STAFF_ROLE_VALUES = Literal["admin", "imam", "collector", "modhin", "watchman"]

class StaffCreate(BaseModel):
    # Assign role to an existing user by their DB id (mosque member flow).
    user_id: Optional[int] = None
    # Standalone staff creation — required when user_id is not provided.
    name: Optional[str] = None
    phone: Optional[str] = None
    role: STAFF_ROLE_VALUES
    is_active: Optional[bool] = None


class StaffUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[STAFF_ROLE_VALUES] = None
    is_active: Optional[bool] = None


class StaffOut(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    role: str
    is_active: bool
    phone_verified: bool
    last_login: Optional[UTCDateTime] = None
    created_at: Optional[UTCDateTime] = None

    class Config:
        from_attributes = True
# ─────────────────────────────────────────────
# 🕌 PRAYER
# ─────────────────────────────────────────────
class PrayerUpdate(BaseModel):
    # Early
    imsak: str
    sunrise: str
    dhuha: str

    # Adhan
    fajr_adhan: str
    dhuhr_adhan: str
    asr_adhan: str
    maghrib_adhan: str
    isha_adhan: str
    jummah_iqamah: str
    # Prayer / Iqamah
    fajr: str
    dhuhr: str
    asr: str
    maghrib: str
    isha: str
    jummah: str

    # Special
    taraweeh: str
    ishraq: str
    sunset: str

    # Optional
    notes: str | None = None


# ============================================================================
# Create Announcement
# ============================================================================

class AnnouncementCreate(BaseModel):
    title: str
    body: str
    pinned: bool = False
    image_url: Optional[str] = None
    audio_url: Optional[str] = None
    target_user_id: Optional[int] = None  # None = broadcast; set to send to one user only

# ============================================================================
# Update Announcement
# ============================================================================

class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    pinned: Optional[bool] = None
    image_url: Optional[str] = None
    audio_url: Optional[str] = None

# ============================================================================
# Response
# ============================================================================

class AnnouncementOut(BaseModel):
    id: int
    title: str
    body: str
    pinned: bool
    posted_by: str
    created_at: UTCDateTime
    image_url: Optional[str] = None
    audio_url: Optional[str] = None
    target_user_id: Optional[int] = None
    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 📖 HADITH
# ─────────────────────────────────────────────
class HadithCreate(BaseModel):
    arabic: Optional[str] = None
    translation: Optional[str] = None
    source: Optional[str] = None
    date: Optional[str] = None
    voice_url: Optional[str] = None
    image_url: Optional[str] = None

    def has_content(self) -> bool:
        return bool(self.arabic or self.translation or self.voice_url or self.image_url)


class HadithOut(BaseModel):
    id: int
    arabic: Optional[str]
    translation: str
    source: Optional[str]
    posted_by: str
    date: Optional[str]
    created_at: UTCDateTime
    voice_url: Optional[str]
    image_url: Optional[str]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# ❓ QUESTIONS
# ─────────────────────────────────────────────
class QuestionCreate(BaseModel):
    question_text: Optional[str] = None
    question_voice_url: Optional[str] = None
    question_image_url: Optional[str] = None

    def has_content(self) -> bool:
        return bool(self.question_text or self.question_voice_url or self.question_image_url)


class AnswerCreate(BaseModel):
    answer_text: Optional[str] = None
    answer_voice_url: Optional[str] = None
    answer_image_url: Optional[str] = None

    def has_content(self) -> bool:
        return bool(self.answer_text or self.answer_voice_url or self.answer_image_url)


class QuestionOut(BaseModel):
    id: int
    question_text: Optional[str]
    question_voice_url: Optional[str]
    status: str
    created_at: UTCDateTime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 💬 REPLIES
# ─────────────────────────────────────────────
class ReplyCreate(BaseModel):
    text: str
    parent_reply_id: Optional[int] = None


class ReplyOut(BaseModel):
    id: int
    text: str
    user_id: int
    hadith_id: int
    parent_reply_id: Optional[int]
    created_at: UTCDateTime
    user_role: Optional[str] = None

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 🎪 FUND (CAMPAIGN)
# ─────────────────────────────────────────────
class FundCreate(BaseModel):
    name: str
    description: Optional[str] = None
    goal_amount: Optional[float] = None
    start_date: Optional[UTCDateTime] = None
    expected_end_date: Optional[UTCDateTime] = None
    status: Optional[str] = "active"

class FundUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    goal_amount: Optional[float] = None
    start_date: Optional[UTCDateTime] = None
    expected_end_date: Optional[UTCDateTime] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None

class FundOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    goal_amount: Optional[float]
    start_date: Optional[UTCDateTime]
    expected_end_date: Optional[UTCDateTime]
    completed_at: Optional[UTCDateTime]
    status: str
    is_active: bool
    is_archived: bool
    created_by: Optional[str]
    created_by_id: Optional[int]
    created_at: UTCDateTime
    updated_at: Optional[UTCDateTime]
    archived_at: Optional[UTCDateTime]
    archived_by: Optional[str]

    class Config:
        from_attributes = True

class FundStats(BaseModel):
    total_donations: int
    total_collected: float
    total_expenses: int
    total_spent: float
    balance: float
    goal_amount: Optional[float]
    progress_pct: Optional[float]
    donor_count: int
    last_donation_at: Optional[UTCDateTime]

class FundDetailOut(FundOut):
    stats: Optional[FundStats] = None

class FundDashboard(BaseModel):
    total_funds: int
    active_funds: int
    total_collected: float
    total_spent: float
    overall_balance: float
    funds: List[FundDetailOut]

# ─────────────────────────────────────────────
# 💰 DONATIONS
# ─────────────────────────────────────────────
class DonationCreate(BaseModel):
    donor_name: str
    amount: float
    method: Literal["cash", "upi", "bank", "cheque"] = "cash"
    note: Optional[str] = None
    member_id: Optional[int] = None
    purpose_id: Optional[int] = None
    fund_id: Optional[int] = None
    donor_type: Optional[str] = "walk_in"  # app_user|member|walk_in|anonymous
    phone: Optional[str] = None
    chanda_no: Optional[str] = None
    donation_date: Optional[UTCDateTime] = None
    receipt_image: Optional[str] = None


class DonationOut(BaseModel):
    id: int
    donor_name: str
    amount: float
    method: str
    note: Optional[str]
    recorded_by: str
    created_at: UTCDateTime
    head_id: Optional[int]
    receipt_id: Optional[str]
    purpose_id: Optional[int] = None
    fund_id: Optional[int] = None
    fund_name: Optional[str] = None
    donor_type: Optional[str] = None
    phone: Optional[str] = None
    chanda_no: Optional[str] = None
    donation_date: Optional[UTCDateTime] = None
    receipt_image: Optional[str] = None

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 🎯 DONATION PURPOSE
# ─────────────────────────────────────────────
class DonationPurposeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    target_amount: Optional[float] = None
    is_active: bool = True


class DonationPurposeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    target_amount: Optional[float] = None
    is_active: Optional[bool] = None


class DonationPurposeOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    target_amount: Optional[float]
    is_active: bool
    is_archived: bool
    created_at: UTCDateTime
    created_by_id: Optional[int]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 👨‍💼 ADMIN
# ─────────────────────────────────────────────
class UserRoleUpdate(BaseModel):
    role: str




class AddFamily(BaseModel):
    chanda_no: Optional[str] = None  # blank => backend auto-generates (see chanda_number_service)
    name: str
    phone: str
    address: Optional[str] = None
    zone: Optional[str] = None
    street: Optional[str] = None
    monthly_amount: float
    registration_date: Optional[UTCDateTime] = None
    historical_payments: Optional[dict] = None


class EditFamily(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    zone: Optional[str] = None
    street: Optional[str] = None
    monthly_amount: Optional[float] = None
    chanda_no: Optional[str] = None
    registration_date: Optional[UTCDateTime] = None


# ─────────────────────────────────────────────
# 👤 APPROVED HEAD (CORE MEMBER)
# ─────────────────────────────────────────────
class HeadBase(BaseModel):
    chanda_no: str
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    zone: Optional[str] = None
    monthly_amount: float


class HeadOut(HeadBase):
    id: int
    is_active: bool
    is_registered: bool
    created_at: UTCDateTime
    registration_date: Optional[UTCDateTime] = None

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 📅 CHANDA COLLECTION
# ─────────────────────────────────────────────
class CollectionBase(BaseModel):
    head_id: int
    month: str
    amount_due: float


class CollectionOut(CollectionBase):
    id: int
    total_paid: float
    status: Literal["pending", "partial", "paid"]
    is_advance: bool = False
    advance_payment_id: Optional[int] = None
    rate_snapshot: Optional[float] = None
    created_at: UTCDateTime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 💰 PAYMENT ENTRY
# ─────────────────────────────────────────────
class ChandaGenerate(BaseModel):
    month: str  # e.g. "2026-08"


class ChandaRateUpdate(BaseModel):
    monthly_amount: float


class CurrentChandaOut(BaseModel):
    head_id: int
    head_name: Optional[str] = None
    month: str
    amount_due: float
    total_paid: float
    balance: float
    status: Literal["pending", "partial", "paid", "not_generated"]
    paid_months: Optional[int] = None
    pending_months: Optional[int] = None
    chanda_no: Optional[str] = None
    address: Optional[str] = None

    class Config:
        from_attributes = True


class PaymentCreate(BaseModel):
    member_id: int
    amount: float
    method: str
    month: Optional[str] = None
    months: Optional[int] = 1          # number of months to cover (for multi-month)
    months_list: Optional[List[str]] = None  # explicit list of YYYY-MM to cover
    purpose: Optional[str] = "Monthly Chanda"
    transaction_ref: Optional[str] = None
    proof_image: Optional[str] = None
    notes: Optional[str] = None
    collected_date: Optional[str] = None
    payment_token: Optional[str] = None  # idempotency key (UUID from client)


class AdminPaymentRecord(BaseModel):
    member_id: int
    amount: float
    method: str = "cash"
    purpose: Optional[str] = "Monthly Chanda"
    months_list: Optional[List[str]] = None   # explicit months to cover
    start_month: Optional[str] = None          # fallback: auto-allocate from this month
    transaction_ref: Optional[str] = None
    note: Optional[str] = None
    collected_date: Optional[str] = None       # ISO datetime from device (for audit)


class PaymentOut(BaseModel):
    id: int
    collection_id: Optional[int]

    amount: float
    method: str
    created_by: Optional[str]
    created_at: UTCDateTime

    collected_by: Optional[str]
    collected_at: Optional[UTCDateTime]

    transaction_ref: Optional[str]
    proof_image: Optional[str]

    status: Literal["pending", "verified", "rejected"]

    verified_by: Optional[str]
    verified_at: Optional[UTCDateTime]

    receipt_id: Optional[str]

    purpose: Optional[str]
    head_id: Optional[int]

    payer_name: Optional[str] = None
    address: Optional[str] = None

    # Who physically made the payment
    paid_by_user_id: Optional[int] = None
    paid_by_name: Optional[str] = None

    months_covered: int
    covered_months: Optional[List[str]]
    coverage_map: Optional[dict[str, float]] = None

    monthly_rate_snapshot: Optional[float] = None
    gross_amount: Optional[float] = None
    discount_amount: Optional[float] = 0
    discount_reason: Optional[str] = None
    payment_token: Optional[str] = None

    class Config:
        from_attributes = True

class ReceiptOut(BaseModel):
    receipt_id: str

    name: str
    amount: float
    purpose: str

    date: UTCDateTime

    # 🔥 IMPORTANT (you asked)
    head_id: Optional[int]
    chanda_no: Optional[str]
    address: Optional[str]

    class Config:
        from_attributes = True

class UserPaymentOut(BaseModel):
    id: int
    amount: float
    purpose: str
    status: Literal["pending", "verified", "rejected"]
    created_at: UTCDateTime
    receipt_id: Optional[str]
    months_covered: Optional[int]
    class Config:
        from_attributes = True
# ─────────────────────────────────────────────
# 📊 RESPONSE STRUCTURES
# ─────────────────────────────────────────────
class MemberWithCollection(BaseModel):
    member: HeadOut
    collections: List[CollectionOut]
    pending_months_count: int = 0

    class Config:
        from_attributes = True


class CollectionWithPayments(BaseModel):
    collection: CollectionOut
    payments: List[PaymentOut]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 💸 EXPENSES
# ─────────────────────────────────────────────
# ─────────────────────────────────────────────
# 🗂️  EXPENSE CATEGORIES
# ─────────────────────────────────────────────
class ExpenseCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True

class ExpenseCategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class ExpenseCategoryOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    is_active: bool
    created_at: UTCDateTime

    class Config:
        from_attributes = True

# ─────────────────────────────────────────────
# 💸 EXPENSES
# ─────────────────────────────────────────────
class ExpenseCreate(BaseModel):
    title: str
    amount: float
    category: Optional[str] = None        # legacy plain-text (still accepted)
    category_id: Optional[int] = None     # preferred
    fund_id: Optional[int] = None
    vendor_name: Optional[str] = None
    expense_date: Optional[UTCDateTime] = None
    note: Optional[str] = None
    receipt_image: Optional[str] = None

class ExpenseUpdate(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    category_id: Optional[int] = None
    fund_id: Optional[int] = None
    vendor_name: Optional[str] = None
    expense_date: Optional[UTCDateTime] = None
    note: Optional[str] = None
    receipt_image: Optional[str] = None
    force: Optional[bool] = None          # superadmin override for approved expense edits

class ExpenseOut(BaseModel):
    id: int
    title: str
    amount: float
    category: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str] = None   # resolved from join
    fund_id: Optional[int] = None
    fund_name: Optional[str] = None
    vendor_name: Optional[str] = None
    expense_date: Optional[UTCDateTime] = None
    note: Optional[str]
    receipt_image: Optional[str]
    receipt_id: Optional[str]
    created_by: Optional[str]
    created_by_id: Optional[int]
    approved_by: Optional[str]
    approved_by_id: Optional[int]
    approved_at: Optional[UTCDateTime]
    created_at: UTCDateTime
    is_deleted: bool = False

    class Config:
        from_attributes = True

class ExpensePage(BaseModel):
    items: List[ExpenseOut]
    total: int
    page: int
    page_size: int
    total_pages: int

class ExpenseStats(BaseModel):
    total_expenses: int
    total_amount: float
    this_month_amount: float
    today_amount: float
    pending_approval: int
    approved: int
    average_expense: Optional[float]
    highest_expense: Optional[float]
    lowest_expense: Optional[float]
    current_month_count: int
    previous_month_count: int
    monthly_growth_pct: Optional[float]

class MonthlySummaryItem(BaseModel):
    month: str
    month_name: str
    count: int
    total_amount: float

class CategorySummaryItem(BaseModel):
    category_id: Optional[int]
    category_name: str
    count: int
    total_amount: float
    percentage: float

class ExpenseDashboard(BaseModel):
    stats: ExpenseStats
    recent: List[ExpenseOut]
    monthly_chart: List[MonthlySummaryItem]
    category_chart: List[CategorySummaryItem]
    pending_approval_count: int


# ─────────────────────────────────────────────
# 📋 AUDIT LOG
# ─────────────────────────────────────────────
class AuditLogOut(BaseModel):
    id: int
    table_name: str
    record_id: int
    action: str
    old_values: Optional[dict]
    new_values: Optional[dict]
    performed_by_id: Optional[int]
    performed_at: UTCDateTime
    ip_address: Optional[str]
    note: Optional[str]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 💹 FINANCE LEDGER
# ─────────────────────────────────────────────
class FinanceTransactionOut(BaseModel):
    id: int
    transaction_type: str
    direction: str
    amount: float
    family_id: Optional[int]
    payment_entry_id: Optional[int]
    donation_id: Optional[int]
    expense_id: Optional[int]
    receipt_number: Optional[str]
    month: Optional[str]
    note: Optional[str]
    created_by_id: Optional[int]
    created_at: UTCDateTime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# ⚙️ FINANCE SETTINGS
# ─────────────────────────────────────────────
class FinanceSettingUpdate(BaseModel):
    mosque_name:    Optional[str] = None
    mosque_address: Optional[str] = None
    mosque_phone:   Optional[str] = None
    upi_id:         Optional[str] = None
    bank_account:   Optional[str] = None   # "Bank | A/C | IFSC" as one field
    receipt_footer: Optional[str] = None
    logo_url:       Optional[str] = None
    sms_template_reminder: Optional[str] = None


class FinanceSettingOut(BaseModel):
    key: str
    value: Optional[str]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 📣 DEFAULTER REMINDERS (push, not SMS)
# ─────────────────────────────────────────────
class DefaulterReminderRequest(BaseModel):
    family_ids: list[int]


class DefaulterReminderResult(BaseModel):
    requested: int
    notified: int
    skipped: list[int]   # family_ids with no registered head/device to notify


# ─────────────────────────────────────────────
# 🧾 UNIFIED RECEIPT
# ─────────────────────────────────────────────
class UnifiedReceiptOut(BaseModel):
    id: int
    receipt_number: str
    transaction_type: str   # chanda | donation | expense
    transaction_id: int     # PK in the source table
    amount: float
    family_id: Optional[int]
    issued_by_id: Optional[int]
    notes: Optional[str]
    created_at: UTCDateTime

    class Config:
        from_attributes = True
