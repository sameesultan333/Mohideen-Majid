import multiprocessing
import os

# ─────────────────────────────────────────────────────────────────────────────
# Workers
# ─────────────────────────────────────────────────────────────────────────────
# Let Render control the worker count through WEB_CONCURRENCY.
# Falls back to 1 worker if not set.
workers = int(
    os.getenv(
        "WEB_CONCURRENCY",
        os.getenv("GUNICORN_WORKERS", "1"),
    )
)

worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000

timeout = 120
keepalive = 5
graceful_timeout = 30

# ─────────────────────────────────────────────────────────────────────────────
# Binding
# ─────────────────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
_log_dir = os.getenv("GUNICORN_LOG_DIR")

accesslog = f"{_log_dir}/access.log" if _log_dir else "-"
errorlog = f"{_log_dir}/error.log" if _log_dir else "-"

loglevel = os.getenv("LOG_LEVEL", "warning")

access_log_format = (
    '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s '
    '"%(f)s" "%(a)s" %(D)sµs'
)

# ─────────────────────────────────────────────────────────────────────────────
# Process
# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT:
# Disable preload so every Gunicorn worker creates its own SQLAlchemy
# engine and database connection after forking.
preload_app = False

# Restart workers periodically to prevent memory leaks.
max_requests = 1000
max_requests_jitter = 100

# ─────────────────────────────────────────────────────────────────────────────
# SSL
# SSL termination is handled by Nginx / Render.
# ─────────────────────────────────────────────────────────────────────────────
# keyfile = None
# certfile = None