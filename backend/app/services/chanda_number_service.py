# backend/app/services/chanda_number_service.py
"""
Single source of truth for auto-generating the next Chanda Number.

Every code path that needs to auto-assign a chanda number (registration
approval, admin family creation, collector family creation) must call
generate_next_chanda_no() rather than computing its own value.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


def generate_next_chanda_no(db: Session) -> str:
    """
    Highest existing purely-numeric chanda_no + 1, as a string.

    Non-numeric legacy values (e.g. "CH0001") are ignored when finding the
    highest value — they don't participate in the sequence at all.
    Starts at "1" if no numeric chanda numbers exist yet.
    """
    rows = (
        db.query(models.ApprovedHead.chanda_no)
        .filter(models.ApprovedHead.chanda_no.isnot(None))
        .all()
    )
    numeric_values = [
        int(cn.strip()) for (cn,) in rows if cn and cn.strip().isdigit()
    ]
    next_num = (max(numeric_values) + 1) if numeric_values else 1
    return str(next_num)
