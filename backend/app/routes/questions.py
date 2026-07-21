import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models import Question, Answer, Reply
from app.schemas import QuestionCreate, AnswerCreate, ReplyCreate
from app.security import get_current_user, require_admin_or_imam
from app.services.audit_service import AuditAction, log_action
from app.utils.content_cleanup import run_content_cleanup
from app.websocket_manager import manager
from app.utils.fcm import notify_user, notify_role
from app.rate_limit import rate_limit

router = APIRouter(prefix="/questions", tags=["Questions"])


# -----------------------------
# 🟢 ASK QUESTION
# -----------------------------
@router.post("/")
async def ask_question(
    payload: QuestionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    await rate_limit(request, "question")
    if not payload.has_content():
        raise HTTPException(status_code=400, detail="At least one of text, voice, or image must be provided")
    run_content_cleanup(db)
    question = Question(
        question_text=payload.question_text,
        question_voice_url=payload.question_voice_url,
        user_id=int(current_user["sub"]),
        status="pending",
        is_active=False,
        created_at=datetime.utcnow()
    )

    db.add(question)
    db.flush()
    await log_action(db, AuditAction.QUESTION_ASKED, "questions", question.id,
                     actor=current_user, request=request,
                     description="Question submitted for review")
    db.commit()
    db.refresh(question)

    notify_role(
        db, "imam",
        title="❓ New Question Submitted",
        body="A community member has submitted a question awaiting your reply.",
        data={"type": "new_question", "question_id": str(question.id)},
    )

    return {"message": "Question submitted successfully"}


# -----------------------------
# 🟡 GET PENDING
# -----------------------------
@router.get("/pending")
def get_pending_questions(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_imam)
):
    run_content_cleanup(db)
    questions = db.query(Question).filter(
        Question.status == "pending"
    ).order_by(Question.created_at.desc()).all()

    return [
        {
            "id": q.id,
            "question_text": q.question_text,
            "voice_url": q.question_voice_url,
            "created_at": q.created_at
        }
        for q in questions
    ]


# -----------------------------
# 🔵 ANSWER QUESTION (FIXED)
# -----------------------------
# -----------------------------
# 🔵 ANSWER QUESTION (FIXED + WS)
# -----------------------------
@router.put("/{question_id}/answer")
async def answer_question(
    question_id: int,
    payload: AnswerCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_imam)
):
    await rate_limit(request, "answer")
    if not payload.has_content():
        raise HTTPException(status_code=400, detail="At least one of text, voice, or image must be provided")
    run_content_cleanup(db)
    question = db.query(Question).filter(Question.id == question_id).first()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if question.status == "answered":
        raise HTTPException(status_code=400, detail="Already answered")

    # 🔥 CLEAN VOICE URL
    voice_url = payload.answer_voice_url
    if voice_url:
        voice_url = voice_url.strip()
        if voice_url.startswith("http"):
            if "/uploads" in voice_url:
                voice_url = voice_url.split("/uploads")[-1]
                voice_url = "/uploads" + voice_url
            else:
                voice_url = None

    logger.debug("[questions] stored voice url: %s", voice_url)

    # 🔥 CLEAN IMAGE URL
    image_url = payload.answer_image_url
    if image_url:
        image_url = image_url.strip()
        if image_url.startswith("http"):
            if "/uploads" in image_url:
                image_url = image_url.split("/uploads")[-1]
                image_url = "/uploads" + image_url
            else:
                image_url = None

    logger.debug("[questions] stored image: %s", image_url)

    # ✅ SAVE ANSWER
    answer = Answer(
        question_id=question.id,
        answer_text=payload.answer_text.strip() if payload.answer_text else None,
        answer_voice_url=voice_url,
        answer_image_url=image_url,
        answered_by=int(current_user["sub"]),
        created_at=datetime.utcnow()
    )

    question.status = "answered"
    question.is_active = True

    db.add(answer)
    db.commit()

    # 🟢 STEP 3 — WEBSOCKET BROADCAST 🔥
    await manager.broadcast("questions", {
        "type": "NEW_QA",
        "data": {
            "id": question.id,
            "question_text": question.question_text,
            "answer_text": answer.answer_text,
            "answer_voice_url": answer.answer_voice_url,
            "answer_image_url": answer.answer_image_url,
            "created_at": str(question.created_at)
        }
    })

    # Personal push to the user who asked (if not anonymous)
    if question.user_id:
        notify_user(
            db, question.user_id,
            title="💬 Your Question Was Answered",
            body="An Imam has replied to your question. Tap to read the answer.",
            data={"type": "question_answered", "question_id": str(question.id)},
        )

    return {"message": "Answer posted successfully"}

# -----------------------------
# 🟣 GET ACTIVE Q&A
# -----------------------------
@router.get("/")
def get_active_qna(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    run_content_cleanup(db)
    questions = db.query(Question).filter(
        Question.is_active == True
    ).order_by(Question.created_at.desc()).limit(10).all()

    # Bulk-load answers instead of one query per question (N+1) — this
    # endpoint is polled every ~30s by every user, so the extra queries
    # add up fast under real traffic.
    question_ids = [q.id for q in questions]
    latest_answer_by_question: dict[int, Answer] = {}
    if question_ids:
        all_answers = (
            db.query(Answer)
            .filter(Answer.question_id.in_(question_ids))
            .order_by(Answer.created_at.desc())
            .all()
        )
        for a in all_answers:
            latest_answer_by_question.setdefault(a.question_id, a)

    response = []

    for q in questions:
        answer = latest_answer_by_question.get(q.id)

        response.append({
            "id": q.id,
            "question_text": q.question_text,
            "question_voice_url": q.question_voice_url,
            "answer_text": answer.answer_text if answer else None,
            "answer_voice_url": answer.answer_voice_url if answer else None,
            "answer_image_url": answer.answer_image_url if answer else None,
            "created_at": q.created_at
        })

    return response


# -----------------------------
# 🔴 REPLY
# -----------------------------
@router.post("/{question_id}/reply")
async def reply_to_question(
    question_id: int,
    payload: ReplyCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    question = db.query(Question).filter(Question.id == question_id).first()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    reply = Reply(
        question_id=question_id,
        parent_reply_id=payload.parent_reply_id,
        user_id=int(current_user["sub"]),
        message=payload.message,
        voice_url=payload.voice_url,
        created_at=datetime.utcnow()
    )

    db.add(reply)
    db.commit()

    await manager.broadcast("questions", {
        "type": "NEW_REPLY",
        "data": {
            "question_id": question_id,
            "message": payload.message,
            "voice_url": payload.voice_url,
            "created_at": str(datetime.utcnow())
        }
    })

    return {"message": "Reply added successfully"}


# -----------------------------
# 🟤 GET REPLIES
# -----------------------------
@router.get("/{question_id}/replies")
def get_replies(
    question_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    replies = db.query(Reply).filter(
        Reply.question_id == question_id
    ).order_by(Reply.created_at.asc()).all()

    return [
        {
            "id": r.id,
            "message": r.message,
            "voice_url": r.voice_url,
            "created_at": r.created_at
        }
        for r in replies
    ]
