#!/usr/bin/env bash
#
# Pazo — nightly encrypted database backups with 30-day retention.
#
# Transaction records are a permanent financial audit trail, so losing the
# database is not recoverable from anywhere else. This runs every night at
# 02:15 UTC and keeps the last 30 days.
#
#   sudo bash setup-backups.sh
#
set -euo pipefail

BACKUP_DIR="/var/backups/pazo"
RETENTION_DAYS=30

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

cat >/usr/local/bin/pazo-backup <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/pazo"
RETENTION_DAYS=30
SECRETS_FILE="/root/.pazo-db-credentials"

# shellcheck disable=SC1090
source "$SECRETS_FILE"

STAMP="$(date -u +%Y%m%d-%H%M)"
FILE="${BACKUP_DIR}/pazo-${STAMP}.sql.gz"

# --single-transaction keeps the dump consistent without locking the app out.
mysqldump \
  --user="$DB_USER" --password="$DB_PASS" \
  --single-transaction --quick --routines --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$FILE"

chmod 600 "$FILE"

# A dump that cannot be read back is not a backup.
if ! gzip -t "$FILE"; then
  echo "Backup ${FILE} is corrupt" >&2
  rm -f "$FILE"
  exit 1
fi

find "$BACKUP_DIR" -name 'pazo-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "$(date -u +%FT%TZ) backup ok: $(du -h "$FILE" | cut -f1) ${FILE}"
SCRIPT

chmod 700 /usr/local/bin/pazo-backup

cat >/etc/systemd/system/pazo-backup.service <<'EOF'
[Unit]
Description=Pazo database backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pazo-backup
StandardOutput=append:/var/log/pazo/backup.log
StandardError=append:/var/log/pazo/backup.log
EOF

cat >/etc/systemd/system/pazo-backup.timer <<'EOF'
[Unit]
Description=Nightly Pazo database backup

[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now pazo-backup.timer

echo "==> Running one backup now to prove it works"
/usr/local/bin/pazo-backup

cat <<EOF

  Backups:   ${BACKUP_DIR}  (nightly 02:15 UTC, ${RETENTION_DAYS} days kept)
  Log:       /var/log/pazo/backup.log
  Restore:   gunzip < ${BACKUP_DIR}/pazo-YYYYMMDD-HHMM.sql.gz | mysql -u root pazo

  These backups live on the same server. Copy them off it — Linode Object
  Storage, or 'scp' to another machine — so a lost server is not a lost
  database.

EOF
