"""
migrate_questions.py

Drops and recreates the 'questions' table to match the updated model.
⚠️  This DELETES all existing question data. Run once after model change.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.database import engine
from app import models

def migrate():
    print("=" * 50)
    print("Migrating 'questions' table...")
    print("=" * 50)

    # Drop in correct order (answers/replies reference questions)
    print("▶ Dropping 'replies' table...")
    models.Reply.__table__.drop(engine, checkfirst=True)

    print("▶ Dropping 'answers' table...")
    models.Answer.__table__.drop(engine, checkfirst=True)

    print("▶ Dropping 'questions' table...")
    models.Question.__table__.drop(engine, checkfirst=True)

    # Recreate
    print("▶ Creating 'questions' table (new schema)...")
    models.Question.__table__.create(engine, checkfirst=True)

    print("▶ Creating 'answers' table...")
    models.Answer.__table__.create(engine, checkfirst=True)

    print("▶ Creating 'replies' table...")
    models.Reply.__table__.create(engine, checkfirst=True)

    print("=" * 50)
    print("✅ Migration complete! Restart your FastAPI server.")
    print("=" * 50)

if __name__ == "__main__":
    migrate()
