#!/usr/bin/env bash
#
# Pazo — deploy or update the application.
#
# First run clones the repo and writes the environment file.
# Later runs pull, rebuild, migrate and restart. Safe to re-run any time.
#
#   sudo bash deploy.sh
#
set -euo pipefail

APP_DIR="/var/www/pazo"
DEPLOY_USER="pazo"
REPO_URL="${PAZO_REPO_URL:-https://github.com/pazoafrika-arch/pazo.git}"
BRANCH="${PAZO_BRANCH:-main}"
SECRETS_FILE="/root/.pazo-db-credentials"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

[ -f "$SECRETS_FILE" ] || { echo "Run setup-db.sh first." >&2; exit 1; }
# shellcheck disable=SC1090
source "$SECRETS_FILE"

say "Fetching the code"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" fetch --all --prune
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
else
  rm -rf "${APP_DIR:?}/"* 2>/dev/null || true
  sudo -u "$DEPLOY_USER" git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

say "Writing the server environment"
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  # Secrets are generated once and then preserved across deploys.
  JWT_ACCESS="$(openssl rand -hex 48)"
  JWT_REFRESH="$(openssl rand -hex 48)"

  read -rp "Public domain for the app (e.g. partners.pazo.africa): " APP_DOMAIN

  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4000
APP_URL=https://${APP_DOMAIN}

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
DB_POOL=15

JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_TTL=30m
JWT_REFRESH_TTL_DAYS=30
BCRYPT_ROUNDS=12
MAX_FAILED_LOGINS=5
LOGIN_LOCK_MINUTES=30

OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
# Production never echoes one-time codes in API responses.
OTP_DEV_ECHO=false

# ---- ClickPesa ----
CLICKPESA_BASE_URL=https://api.clickpesa.com/third-parties
CLICKPESA_CLIENT_ID=
CLICKPESA_API_KEY=
CLICKPESA_CHECKSUM_KEY=
CLICKPESA_WEBHOOK_IPS=
EOF
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created ${ENV_FILE}. Add your ClickPesa keys there when you have them."
else
  echo "Keeping the existing ${ENV_FILE}."
fi

APP_DOMAIN="$(grep '^APP_URL=' "$ENV_FILE" | sed 's|^APP_URL=https\?://||')"

say "Installing server dependencies"
sudo -u "$DEPLOY_USER" npm --prefix "$APP_DIR/server" ci --omit=dev 2>/dev/null \
  || sudo -u "$DEPLOY_USER" npm --prefix "$APP_DIR/server" install --omit=dev

say "Running database migrations"
sudo -u "$DEPLOY_USER" npm --prefix "$APP_DIR/server" run migrate

say "Building the web app"
# The browser calls the API on the same domain, proxied by nginx.
sudo -u "$DEPLOY_USER" sh -c "cd '$APP_DIR/web' && printf 'VITE_API_URL=/api/v1\n' > .env.production"
sudo -u "$DEPLOY_USER" npm --prefix "$APP_DIR/web" ci 2>/dev/null \
  || sudo -u "$DEPLOY_USER" npm --prefix "$APP_DIR/web" install
# Cap the build's heap. On a 1GB server an uncapped build gets killed.
sudo -u "$DEPLOY_USER" env NODE_OPTIONS=--max-old-space-size=768 \
  npm --prefix "$APP_DIR/web" run build

say "Installing the systemd service"
cat >/etc/systemd/system/pazo-api.service <<EOF
[Unit]
Description=Pazo partner platform API
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/pazo/api.log
StandardError=append:/var/log/pazo/api.log
Environment=NODE_ENV=production

# The service can only touch what it needs.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/pazo
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pazo-api
systemctl restart pazo-api
sleep 3
systemctl --no-pager --lines=10 status pazo-api || true

say "Configuring nginx"
cat >/etc/nginx/sites-available/pazo <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN};

    root ${APP_DIR}/web/dist;
    index index.html;

    # Hide the server version and set sensible browser protections.
    server_tokens off;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 2m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # API, referral links and payment callbacks go to the Node service.
    location ~ ^/(api|r)/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
    }

    # Hashed build assets never change, so cache them hard.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Single-page app: unknown paths fall through to index.html.
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pazo /etc/nginx/sites-enabled/pazo

# The default placeholder page is removed only if it is still the stock one.
# Any other site on this server is left completely alone: nginx serves each
# by its own domain name, so they coexist.
if [ -L /etc/nginx/sites-enabled/default ] \
   && grep -q "Welcome to nginx" /var/www/html/index.nginx-debian.html 2>/dev/null; then
  rm -f /etc/nginx/sites-enabled/default
  echo "  Removed the stock nginx placeholder."
fi

echo "  Sites now enabled:"
ls -1 /etc/nginx/sites-enabled/ | sed 's/^/    /'

nginx -t
systemctl reload nginx

say "Deployment complete"
cat <<EOF

  App:     http://${APP_DOMAIN}
  Health:  http://${APP_DOMAIN}/health
  Logs:    journalctl -u pazo-api -f   (or /var/log/pazo/api.log)

  Next:
    HTTPS:  bash enable-https.sh ${APP_DOMAIN}
    Seed:   sudo -u ${DEPLOY_USER} npm --prefix ${APP_DIR}/server run seed
            (demo data only — skip for a real launch)

EOF
