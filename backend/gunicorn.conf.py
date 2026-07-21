import multiprocessing
import os

# ── Workers ────────────────────────────────────────────────────────────────
# 2–4 workers for a single-core VPS; increase if you have more cores.
workers = int(os.getenv("GUNICORN_WORKERS", max(2, multiprocessing.cpu_count())))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 120
keepalive = 5
graceful_timeout = 30

# ── Binding ─────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"

# ── Logging ─────────────────────────────────────────────────────────────────
# Defaults to stdout/stderr ("-") so this works out of the box on Render
# (which captures process stdout/stderr directly, and may not even use this
# Dockerfile — native Python runtimes don't have /app or a mounted volume).
# Set GUNICORN_LOG_DIR to switch to file-based logs, e.g. for the
# docker-compose VPS setup where a volume is mounted at /app/logs.
_log_dir = os.getenv("GUNICORN_LOG_DIR")
accesslog  = f"{_log_dir}/access.log" if _log_dir else "-"
errorlog   = f"{_log_dir}/error.log" if _log_dir else "-"
loglevel   = os.getenv("LOG_LEVEL", "warning")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'

# ── Process ──────────────────────────────────────────────────────────────────
preload_app = True          # load app once, fork workers (saves RAM)
max_requests = 1000         # restart workers periodically to prevent memory leaks
max_requests_jitter = 100   # add jitter so workers don't all restart at once

# ── SSL (terminate at Nginx; no SSL here) ───────────────────────────────────
# keyfile  = None
# certfile = None
