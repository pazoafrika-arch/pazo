#!/usr/bin/env bash
#
# Pazo — production readiness check.
#
# Run after deploying and before letting real people in. Reports anything
# that would be unsafe or broken in production.
#
#   sudo bash preflight.sh
#
set -uo pipefail

APP_DIR="/var/www/pazo"
ENV_FILE="$APP_DIR/server/.env"
PASS=0
WARN=0
FAIL=0

ok()   { printf '  \033[0;32mOK\033[0m    %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[0;33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  \033[0;31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }

envval() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

echo
echo "Pazo production readiness"
echo "========================="
echo

echo "Secrets"
[ -f "$ENV_FILE" ] || { bad "No .env at ${ENV_FILE}"; exit 1; }

[ "$(envval NODE_ENV)" = "production" ] \
  && ok "NODE_ENV is production" \
  || bad "NODE_ENV is not production — errors will leak stack traces"

[ "$(envval OTP_DEV_ECHO)" = "false" ] \
  && ok "OTP codes are not echoed in API responses" \
  || bad "OTP_DEV_ECHO is on — anyone could read a one-time code and sign in"

ACCESS="$(envval JWT_ACCESS_SECRET)"
REFRESH="$(envval JWT_REFRESH_SECRET)"
if [ ${#ACCESS} -ge 32 ] && [ ${#REFRESH} -ge 32 ] \
   && [ "$ACCESS" != "change-me-access-secret" ] \
   && [ "$ACCESS" != "$REFRESH" ]; then
  ok "JWT secrets are long and distinct"
else
  bad "JWT secrets are weak, default, or identical"
fi

PERMS="$(stat -c '%a' "$ENV_FILE")"
[ "$PERMS" = "600" ] && ok ".env is readable only by its owner" \
  || warn ".env permissions are ${PERMS}, expected 600"

echo
echo "Payments"
if [ -n "$(envval CLICKPESA_CLIENT_ID)" ] && [ -n "$(envval CLICKPESA_API_KEY)" ]; then
  ok "ClickPesa credentials are set"
  [ -n "$(envval CLICKPESA_CHECKSUM_KEY)" ] \
    && ok "Webhook checksum key is set" \
    || warn "No checksum key — every callback needs a confirming call to the gateway"
else
  warn "ClickPesa not configured — withdrawals will queue safely but not send"
fi

echo
echo "Services"
systemctl is-active --quiet pazo-api && ok "API service is running" || bad "API service is not running"
systemctl is-active --quiet nginx && ok "nginx is running" || bad "nginx is not running"
systemctl is-active --quiet mysql && ok "MySQL is running" || bad "MySQL is not running"
systemctl is-enabled --quiet pazo-api && ok "API starts on boot" || warn "API will not start on boot"

HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:4000/health 2>/dev/null || echo '')"
echo "$HEALTH" | grep -q '"database":"up"' \
  && ok "API reports the database is up" \
  || bad "API health check failed"

echo
echo "Database"
MYSQL_BIND="$(mysql -NBe "SELECT @@bind_address" 2>/dev/null || echo unknown)"
[ "$MYSQL_BIND" = "127.0.0.1" ] \
  && ok "MySQL listens on localhost only" \
  || bad "MySQL bind-address is ${MYSQL_BIND} — it may be reachable from the internet"

TZ_OK="$(mysql -NBe "SELECT IF(NOW()=UTC_TIMESTAMP(),'yes','no')" 2>/dev/null || echo no)"
[ "$TZ_OK" = "yes" ] && ok "MySQL is on UTC" || bad "MySQL is not on UTC — scheduled jobs and date filters will drift"

DEMO="$(mysql -NBe "SELECT COUNT(*) FROM pazo.users WHERE email LIKE '%demo.pazo%' OR email='demo@thetravela.com'" 2>/dev/null || echo 0)"
[ "$DEMO" = "0" ] \
  && ok "No demo accounts present" \
  || warn "${DEMO} demo accounts still exist — remove or change their passwords before launch"

echo
echo "Network"
ufw status | grep -q "Status: active" && ok "Firewall is active" || bad "Firewall is inactive"
ufw status | grep -qE "3306.*ALLOW" && bad "Port 3306 is open to the internet" || ok "Database port is not exposed"

grep -qE "^PasswordAuthentication no" /etc/ssh/sshd_config \
  && ok "SSH password login is disabled" \
  || warn "SSH still accepts passwords — key-only is safer"

echo
echo "HTTPS"
DOMAIN="$(envval APP_URL | sed 's|^https\?://||')"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  ok "Certificate installed for ${DOMAIN}"
  EXPIRY="$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" | cut -d= -f2)"
  DAYS=$(( ( $(date -d "$EXPIRY" +%s) - $(date +%s) ) / 86400 ))
  [ "$DAYS" -gt 20 ] && ok "Certificate valid for ${DAYS} more days" \
    || warn "Certificate expires in ${DAYS} days"
  systemctl is-enabled --quiet certbot.timer && ok "Automatic renewal is on" \
    || warn "Certificate auto-renewal is not enabled"
else
  bad "No certificate for ${DOMAIN} — run enable-https.sh (ClickPesa webhooks need HTTPS)"
fi

echo
echo "Backups"
systemctl is-enabled --quiet pazo-backup.timer \
  && ok "Nightly backups scheduled" \
  || warn "No backup timer — run setup-backups.sh"
COUNT="$(find /var/backups/pazo -name 'pazo-*.sql.gz' 2>/dev/null | wc -l)"
[ "$COUNT" -gt 0 ] && ok "${COUNT} backup file(s) present" || warn "No backups taken yet"

echo
echo "========================="
printf "  %d passed, %d warnings, %d failures\n\n" "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "  Fix the failures before going live."; echo; exit 1; }
[ "$WARN" -eq 0 ] && echo "  Ready for production." && echo
exit 0
