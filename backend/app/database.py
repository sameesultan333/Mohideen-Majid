import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/mohideen_db",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,         # detect stale connections before use
    pool_size=10,               # base connection pool size
    max_overflow=20,            # max extra connections under load
    pool_timeout=30,            # seconds to wait for a connection
    pool_recycle=1800,          # recycle connections every 30 min
    connect_args={
        # Render's managed Postgres sits behind a proxy that can silently
        # drop a connection mid-negotiation ("SSL connection has been closed
        # unexpectedly") — TCP keepalives let the client notice a dead
        # socket and recycle it instead of hanging or handing back a
        # half-open connection. connect_timeout keeps a genuinely stuck
        # handshake from hanging indefinitely during worker boot.
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    },
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
