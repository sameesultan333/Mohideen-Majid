#!/usr/bin/env bash
# Daily PostgreSQL + uploads backup
# Usage: ./backup.sh
# Cron:  0 2 * * * /opt/mohideen/deploy/backup.sh >> /var/log/mohideen-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="/var/backups/mohideen"
KEEP_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)

# Load env
source /opt/mohideen/backend/.env 2>/dev/null || true

POSTGRES_USER="${POSTGRES_USER:-mohideen}"
POSTGRES_DB="${POSTGRES_DB:-mohideen_db}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/uploads"

echo "[$(date -Iseconds)] Starting backup..."

# ── Database dump ─────────────────────────────────────────────────────────────
DUMP_FILE="$BACKUP_DIR/db/mohideen_${DATE}.sql.gz"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    -h localhost -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip -9 > "$DUMP_FILE"
echo "[$(date -Iseconds)] DB dump: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# ── Uploads archive ───────────────────────────────────────────────────────────
UPLOADS_FILE="$BACKUP_DIR/uploads/uploads_${DATE}.tar.gz"
tar -czf "$UPLOADS_FILE" -C /opt/mohideen/backend uploads/ 2>/dev/null || true
echo "[$(date -Iseconds)] Uploads: $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"

# ── Prune old backups ─────────────────────────────────────────────────────────
find "$BACKUP_DIR/db"      -name "*.sql.gz"   -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR/uploads" -name "*.tar.gz"   -mtime "+$KEEP_DAYS" -delete
echo "[$(date -Iseconds)] Pruned backups older than ${KEEP_DAYS} days"

echo "[$(date -Iseconds)] Backup complete ✓"
