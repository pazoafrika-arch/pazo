#!/usr/bin/env bash
#
# Pazo — turn on HTTPS with a free Let's Encrypt certificate.
#
# Point your domain's A record at this server BEFORE running this, or the
# certificate check will fail.
#
#   sudo bash enable-https.sh partners.pazo.africa
#
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi
if [ -z "$DOMAIN" ]; then
  echo "Usage: bash enable-https.sh <domain> [admin-email]" >&2
  exit 1
fi
if [ -z "$EMAIL" ]; then
  read -rp "Email for certificate expiry notices: " EMAIL
fi

echo "==> Checking that ${DOMAIN} points here"
SERVER_IP="$(curl -fsS https://api.ipify.org || echo unknown)"
DOMAIN_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo none)"
echo "    this server: ${SERVER_IP}"
echo "    ${DOMAIN}: ${DOMAIN_IP}"
if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
  echo
  echo "    They do not match. DNS may still be propagating."
  read -rp "    Continue anyway? [y/N] " GO
  [ "$GO" = "y" ] || exit 1
fi

echo "==> Requesting the certificate"
# certbot edits the nginx config in place and sets up the HTTP redirect.
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive --agree-tos \
  --email "$EMAIL" \
  --redirect

echo "==> Adding HSTS"
# Tells browsers to refuse plain HTTP for this domain in future.
CONF=/etc/nginx/sites-available/pazo
if ! grep -q "Strict-Transport-Security" "$CONF"; then
  sed -i '/listen 443 ssl/a\    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' "$CONF"
fi
nginx -t && systemctl reload nginx

echo "==> Confirming automatic renewal"
systemctl list-timers certbot.timer --no-pager || true
certbot renew --dry-run

echo
echo "  HTTPS is live: https://${DOMAIN}"
echo "  ClickPesa webhook URL: https://${DOMAIN}/api/v1/webhooks/clickpesa"
echo
