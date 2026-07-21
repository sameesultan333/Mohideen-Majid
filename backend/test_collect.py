import datetime
from app import models, schemas
from app.database import SessionLocal
from app.routes.chanda import collect_payment

db = SessionLocal()
try:
    # Let's find head with id 71 (Arif Hussain) or any active member
    head = db.query(models.ApprovedHead).first()
    if head:
        print(f"Testing for member: {head.name} (id: {head.id})")
        # Let's construct PaymentCreate
        data = schemas.PaymentCreate(
            member_id=head.id,
            amount=500.0,
            method="cash",
            month="2026-04",
            purpose="Monthly Chanda",
            collected_date=datetime.datetime.utcnow()
        )
        # Mock user
        class MockUser:
            pass
        user = {"sub": "1"} # Mock sub id
        
        # We need to run it in a session block
        try:
            res = collect_payment(data=data, db=db, user=user)
            print("Success:", res)
        except Exception as e:
            print("Error occurred:")
            import traceback
            traceback.print_exc()
    else:
        print("No head found")
finally:
    db.close()
