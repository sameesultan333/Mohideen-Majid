from app.database import engine
from sqlalchemy import text

migrations = [
    "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audio_url TEXT",
    "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITHOUT TIME ZONE",
]

with engine.begin() as conn:
    for sql in migrations:
        conn.execute(text(sql))
        print(f"OK: {sql}")

print("\nAll migrations applied successfully!")
