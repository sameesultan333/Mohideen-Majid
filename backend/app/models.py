# backend/app/models.py

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime


# ─────────────────────────────────────────────────────────────
# ✅ APPROVED HEADS (Excel Source of Truth)
# ─────────────────────────────────────────────────────────────
class ApprovedHead(Base):
    __tablename__ = "approved_heads"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    phone = Column(String, unique=True, index=True, nullable=False)
    address = Column(String, nullable=True)

    # Registration tracking
    is_registered = Column(Boolean, default=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# ✅ USERS (HEAD + MEMBERS)
# ─────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)

    phone = Column(String, unique=True, index=True, nullable=False)

    password = Column(String, nullable=False)  # required for login

    role = Column(String, nullable=False)
    # superadmin / admin / imam / head / member

    # 🔑 FAMILY LINK
    head_phone = Column(String, nullable=False)
    # head → own phone
    # member → head's phone

    address = Column(String, nullable=True)  # optional (head from Excel)

    expo_token = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    questions = relationship("Question", back_populates="asker")
    donations = relationship("Donation", back_populates="donor_user")


# ─────────────────────────────────────────────────────────────
# ✅ PRAYER TIMINGS
# ─────────────────────────────────────────────────────────────
class PrayerTiming(Base):
    __tablename__ = "prayer_timings"

    id = Column(Integer, primary_key=True, index=True)

    imsak = Column(String)
    dhuha = Column(String)

    fajr_adhan = Column(String)
    dhuhr_adhan = Column(String)
    asr_adhan = Column(String)
    maghrib_adhan = Column(String)
    isha_adhan = Column(String)

    fajr = Column(String)
    dhuhr = Column(String)
    asr = Column(String)
    maghrib = Column(String)
    isha = Column(String)
    jummah = Column(String)

    taraweeh = Column(String)
    ishraq = Column(String)

    updated_by = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# ✅ ANNOUNCEMENTS
# ─────────────────────────────────────────────────────────────
class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)

    pinned = Column(Boolean, default=False)

    posted_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# ✅ HADITH
# ─────────────────────────────────────────────────────────────
class Hadith(Base):
    __tablename__ = "hadiths"

    id = Column(Integer, primary_key=True, index=True)

    arabic = Column(Text, nullable=True)
    translation = Column(Text, nullable=False)
    source = Column(String, nullable=True)

    posted_by = Column(String, nullable=False)
    date = Column(String, nullable=True)

    voice_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# ✅ QUESTIONS
# ─────────────────────────────────────────────────────────────
class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)

    question_text = Column(Text, nullable=False)
    question_voice_url = Column(String, nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"))

    status = Column(String, default="pending")
    is_active = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    asker = relationship("User", back_populates="questions")
    answers = relationship("Answer", back_populates="question")


# ─────────────────────────────────────────────────────────────
# ✅ ANSWERS
# ─────────────────────────────────────────────────────────────
class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)

    question_id = Column(Integer, ForeignKey("questions.id"))

    answer_text = Column(Text, nullable=True)
    answer_voice_url = Column(String, nullable=True)

    answered_by = Column(Integer, ForeignKey("users.id"))

    answer_image_url = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    question = relationship("Question", back_populates="answers")


# ─────────────────────────────────────────────────────────────
# ✅ DONATIONS
# ─────────────────────────────────────────────────────────────
class Donation(Base):
    __tablename__ = "donations"

    id = Column(Integer, primary_key=True, index=True)

    donor_name = Column(String, nullable=False)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    amount = Column(String, nullable=False)
    method = Column(String, default="cash")
    note = Column(Text, nullable=True)

    recorded_by = Column(String, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    donor_user = relationship("User", back_populates="donations")


# ─────────────────────────────────────────────────────────────
# ✅ REPLIES
# ─────────────────────────────────────────────────────────────
class Reply(Base):
    __tablename__ = "replies"

    id = Column(Integer, primary_key=True, index=True)

    hadith_id = Column(Integer, ForeignKey("hadiths.id"))

    text = Column(Text, nullable=False)

    parent_reply_id = Column(Integer, ForeignKey("replies.id"), nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"))

    created_at = Column(DateTime, default=datetime.utcnow)