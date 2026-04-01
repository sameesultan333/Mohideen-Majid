import sys
import os
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.database import engine
from app import models

def fix_announcements():
    print("Dropping announcements table...")
    models.Announcement.__table__.drop(engine, checkfirst=True)
    print("Creating announcements table...")
    models.Announcement.__table__.create(engine, checkfirst=True)
    print("Done!")

def fix_prayer_db():
    print("Dropping prayer_timings table...")
    models.PrayerTiming.__table__.drop(engine, checkfirst=True)
    print("Creating prayer_timings table...")
    models.PrayerTiming.__table__.create(engine, checkfirst=True)
    print("Done!")

if __name__ == "__main__":
    # fix_announcements()
    fix_prayer_db()
