# Mohideen Production Deployment

This covers two deployment paths: a self-managed VPS (docker-compose + Nginx,
below) and Render (below, no Docker required unless you want it).

## Render Deployment

1. **Database**: create a Render PostgreSQL instance. Copy its "Internal
   Database URL" — use that as `DATABASE_URL` (Render's internal URL avoids
   egress and is faster than the external one).
2. **Redis**: create a Render Redis (Key Value) instance, or point
   `REDIS_URL` at any external Redis. Rate limiting fails open (logs a
   warning, does not block requests) if Redis is unreachable — the app still
   runs without it, just without rate limiting.
3. **Web Service**: point Render at `backend/` as the root directory.
   - If using Render's native Python runtime (no Dockerfile): build command
     `pip install -r requirements.txt`; start command
     `gunicorn app.main:app --config gunicorn.conf.py`.
   - If using the Dockerfile: Render builds and runs it as-is.
   - Health check path: `/health` (returns 200 when healthy, 503 when
     degraded — already wired up for Render's health checks).
4. **Environment variables** (Render dashboard → Environment): set every
   value from `backend/.env.example` — at minimum `SECRET_KEY` (generate a
   fresh one, `openssl rand -hex 32` — see the Security note below),
   `DATABASE_URL`, `REDIS_URL`, `ALLOWED_ORIGINS` (your deployed admin
   frontend's actual URL — CORS defaults to `localhost:5173` only, requests
   from anywhere else are blocked until this is set), `COOKIE_SECURE=true`,
   `ENVIRONMENT=production`.
5. **Firebase (FCM push)**: either set `FIREBASE_SERVICE_ACCOUNT_PATH` to a
   file you upload as a Render Secret File, or set the equivalent
   credentials via env vars if you adapt `app/utils/fcm.py` to read from one
   — the service account JSON is never committed to git (correctly
   gitignored) so it has to be provisioned separately on every environment.
6. **Uploads persistence**: Render's default web service filesystem is
   **ephemeral** — anything written to `backend/uploads/` (payment proof
   screenshots, hadith images, audio) is lost on every redeploy or restart
   unless you either (a) attach a Render Disk mounted at that path, or
   (b) set the `CLOUDINARY_*` env vars so uploads go to Cloudinary instead
   of local disk (the code already prefers Cloudinary when configured — see
   `app/routes/upload.py`). Pick one before relying on uploaded images
   surviving a deploy.
7. **Security**: the `SECRET_KEY`, database password, and Redis password
   that were in this repo's git history must be treated as compromised and
   rotated — generate fresh values for Render regardless of what's in
   `backend/.env.example` or any old `.env`.

## VPS Deployment

### 1 — Prerequisites (VPS)
```bash
apt-get update && apt-get install -y docker.io docker-compose-plugin certbot fail2ban
```

### 2 — Clone & configure
```bash
git clone <repo> /opt/mohideen
cd /opt/mohideen

# Copy and fill in secrets
cp backend/.env.example backend/.env
nano backend/.env          # set DATABASE_URL, REDIS_URL, SECRET_KEY, ALLOWED_ORIGINS, etc.

# Replace YOUR_DOMAIN_HERE in nginx config
sed -i 's/YOUR_DOMAIN_HERE/api.yourmasjid.com/g' nginx/conf.d/mohideen.conf
```

### 3 — SSL (Let's Encrypt)
```bash
# Start nginx on port 80 only (comment out 443 block temporarily)
docker compose up -d nginx

# Obtain certificate
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d api.yourmasjid.com \
  --email admin@yourmasjid.com --agree-tos --no-eff-email

# Re-enable 443 block in nginx/conf.d/mohideen.conf, then:
docker compose restart nginx
```

### 4 — Start all services
```bash
docker compose up -d
docker compose logs -f api    # verify startup
curl https://api.yourmasjid.com/health
```

### 5 — Backups (cron)
```bash
chmod +x deploy/backup.sh
# Add to crontab:
# 0 2 * * *  /opt/mohideen/deploy/backup.sh
```

### 6 — Log rotation
```bash
cp deploy/logrotate.conf /etc/logrotate.d/mohideen
```

### 7 — Fail2Ban
```bash
cp deploy/fail2ban-mohideen.conf /etc/fail2ban/filter.d/mohideen.conf
# Append jail config (see comments in that file) to /etc/fail2ban/jail.local
systemctl restart fail2ban
```

### 8 — Auto-renew SSL
```bash
# docker-compose certbot service handles this; verify with:
docker compose logs certbot
```

### Updating the app
```bash
git pull
docker compose up -d --build api
```

## Health check
```
GET /health  →  { "status": "ok", "database": "ok", "redis": "ok", ... }
```
