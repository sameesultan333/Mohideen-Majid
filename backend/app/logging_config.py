"""
Structured logging for production.
Call configure_logging() once at startup (done automatically via main.py import).
"""
import logging
import logging.handlers
import os
from pathlib import Path

LOG_DIR = Path(os.getenv("LOG_DIR", "/app/logs"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")


def configure_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)

    fmt_verbose = logging.Formatter(
        "%(asctime)s %(levelname)-8s %(name)s:%(lineno)d — %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    fmt_simple = logging.Formatter("%(levelname)-8s %(name)s — %(message)s")

    # ── Console handler (always on) ──────────────────────────────────────────
    console = logging.StreamHandler()
    console.setLevel(LOG_LEVEL)
    console.setFormatter(fmt_simple if ENVIRONMENT == "development" else fmt_verbose)
    root.addHandler(console)

    if ENVIRONMENT == "production":
        # ── Application log (rotating, 10 MB × 5 files) ──────────────────────
        app_handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / "app.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        app_handler.setFormatter(fmt_verbose)
        root.addHandler(app_handler)

        # ── Error log (WARNING+) ──────────────────────────────────────────────
        err_handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / "error.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        err_handler.setLevel(logging.WARNING)
        err_handler.setFormatter(fmt_verbose)
        root.addHandler(err_handler)

    # Silence noisy third-party libraries
    for lib in ("uvicorn.access", "apscheduler", "passlib", "multipart"):
        logging.getLogger(lib).setLevel(logging.WARNING)

    logging.getLogger("uvicorn.error").setLevel(logging.ERROR)

    logging.getLogger("mohideen").info(
        "Logging configured — level=%s env=%s", LOG_LEVEL, ENVIRONMENT
    )
