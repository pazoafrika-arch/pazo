#!/usr/bin/env bash
#
# Pazo — create the database and a least-privilege application user.
# Generates a strong password and writes it where deploy.sh will find it.
#
#   sudo bash setup-db.sh
#
set -euo pipefail

DB_NAME="pazo"
DB_USER="pazo_app"
SECRETS_FILE="/root/.pazo-db-credentials"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

if [ -f "$SECRETS_FILE" ]; then
  echo "Credentials already exist at ${SECRETS_FILE}. Delete it first to regenerate."
  exit 0
fi

DB_PASS="$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)"

mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';

-- The application needs data and schema rights on its own database only.
-- It is never granted anything server-wide.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES,
      CREATE TEMPORARY TABLES, LOCK TABLES
  ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

umask 077
cat >"$SECRETS_FILE" <<EOF
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
EOF
chmod 600 "$SECRETS_FILE"

echo "Database '${DB_NAME}' and user '${DB_USER}' created."
echo "Credentials written to ${SECRETS_FILE} (root only)."
