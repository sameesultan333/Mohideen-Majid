from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://postgres:Sameesultan333@localhost:5432/mohideen_db"
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("APPROVED HEADS:")
    res = conn.execute(text("SELECT id, chanda_no, name, phone, monthly_amount FROM approved_heads"))
    for row in res:
        print(" -", row)

    print("\nCHANDA COLLECTIONS:")
    res = conn.execute(text("SELECT id, head_id, month, amount_due, total_paid, status FROM chanda_collections ORDER BY head_id, month"))
    for row in res:
        print(" -", row)

    print("\nPAYMENT ENTRIES:")
    res = conn.execute(text("SELECT id, head_id, amount, method, status, purpose, months_covered, covered_months, coverage_map FROM payment_entries"))
    for row in res:
        print(" -", row)
