import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes.chanda import validate_rollback_decision
from app.utils.payment_ledger import generate_receipt_id
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


class TempPaymentEntry(Base):
    __tablename__ = "payment_entries"

    id = Column(Integer, primary_key=True)
    receipt_id = Column(String, nullable=True)
    amount = Column(Integer, nullable=False)


def test_validate_rollback_decision_blocks_self_action():
    request = SimpleNamespace(requested_by_id=7)

    with pytest.raises(HTTPException) as exc:
        validate_rollback_decision(request, acting_user_id=7)

    assert exc.value.status_code == 403
    assert "your own rollback request" in str(exc.value.detail).lower()


def test_generate_receipt_id_uses_next_available_sequence():
    engine = create_engine("sqlite:///:memory:")
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    db = Session()
    try:
        db.add(TempPaymentEntry(receipt_id="MM-CH-202601-000001", amount=10))
        db.commit()

        receipt_id = generate_receipt_id(db, prefix="CH", created_at="2026-01-15T00:00:00")
        assert receipt_id == "MM-CH-202601-000002"
    finally:
        db.close()
