FROM python:3.11-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Uploads directory persisted via volume
RUN mkdir -p uploads/images uploads/payments uploads/screenshots
# gunicorn.conf.py writes access/error logs here — without this, gunicorn
# crashes on startup on any platform that doesn't mount a volume at this
# path (e.g. a bare Render deploy, vs. docker-compose which auto-creates
# the mount point for its named "api_logs" volume).
RUN mkdir -p logs

EXPOSE 8000

CMD ["gunicorn", "app.main:app", "--config", "gunicorn.conf.py"]
