# backend/app/schemas.py

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ─────────────────────────────────────────────────────────────
# ✅ HEAD REGISTER
# ─────────────────────────────────────────────────────────────
class HeadRegister(BaseModel):
    phone: str
    password: str


# ─────────────────────────────────────────────────────────────
# ✅ MEMBER REGISTER
# ─────────────────────────────────────────────────────────────
class MemberRegister(BaseModel):
    name: str
    phone: str
    password: str
    head_phone: str


# ─────────────────────────────────────────────────────────────
# ✅ LOGIN (PASSWORD STEP)
# ─────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    phone: str
    password: str


# ─────────────────────────────────────────────────────────────
# ✅ OTP VERIFY
# ─────────────────────────────────────────────────────────────
class VerifyLoginOTP(BaseModel):
    phone: str
    otp: str


# ─────────────────────────────────────────────────────────────
# ✅ TOKEN RESPONSE
# ─────────────────────────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ─────────────────────────────────────────────────────────────
# ✅ USER OUTPUT
# ─────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    name: str
    phone: str
    role: str
    head_phone: str
    created_at: Optional[datetime] = None   # ✅ FIX

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# ✅ PRAYER
# ─────────────────────────────────────────────────────────────
class PrayerUpdate(BaseModel):
    imsak: str
    dhuha: str

    fajr_adhan: str
    dhuhr_adhan: str
    asr_adhan: str
    maghrib_adhan: str
    isha_adhan: str

    fajr: str
    dhuhr: str
    asr: str
    maghrib: str
    isha: str
    jummah: str

    taraweeh: str
    ishraq: str


# ─────────────────────────────────────────────────────────────
# ✅ ANNOUNCEMENTS
# ─────────────────────────────────────────────────────────────
class AnnouncementCreate(BaseModel):
    title: str
    body: str
    pinned: bool = False


class AnnouncementOut(BaseModel):
    id: int
    title: str
    body: str
    pinned: bool
    posted_by: str
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# ✅ HADITH
# ─────────────────────────────────────────────────────────────
class HadithCreate(BaseModel):
    arabic: Optional[str] = None
    translation: str
    source: Optional[str] = None
    date: Optional[str] = None
    voice_url: Optional[str] = None
    image_url: Optional[str] = None


class HadithOut(BaseModel):
    id: int
    arabic: Optional[str]
    translation: str
    source: Optional[str]
    posted_by: str
    date: Optional[str]
    created_at: datetime
    voice_url: Optional[str]
    image_url: Optional[str]

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# ✅ QUESTIONS
# ─────────────────────────────────────────────────────────────
class QuestionCreate(BaseModel):
    question_text: Optional[str]
    question_voice_url: Optional[str]


class AnswerCreate(BaseModel):
    answer_text: Optional[str]
    answer_voice_url: Optional[str]
    answer_image_url: Optional[str] = None


class QuestionOut(BaseModel):
    id: int
    question_text: Optional[str]
    question_voice_url: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# ✅ REPLIES
# ─────────────────────────────────────────────────────────────
class ReplyCreate(BaseModel):
    text: str
    parent_reply_id: Optional[int] = None


class ReplyOut(BaseModel):
    id: int
    text: str
    user_id: int
    hadith_id: int
    parent_reply_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# ✅ DONATIONS
# ─────────────────────────────────────────────────────────────
class DonationCreate(BaseModel):
    donor_name: str
    amount: str
    method: str = "cash"
    note: Optional[str] = None


class DonationOut(BaseModel):
    id: int
    donor_name: str
    amount: str
    method: str
    note: Optional[str]
    recorded_by: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserRoleUpdate(BaseModel):
    role: str  # superadmin / admin / imam

class CreateStaff(BaseModel):
    name: str
    phone: str
    password: str
    role: str  # admin / imam