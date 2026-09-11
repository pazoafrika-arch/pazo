#!/usr/bin/env bash
#
# Pazo — look before touching.
#
# Reports what this server is already running so nothing gets broken.
# Reads only. Changes nothing.
#
#   sudo bash survey.sh
#
set -uo pipefail

echo
echo "================================================"
echo " Server survey — read only, nothing is changed"
echo "================================================"

echo
echo "--- Machine ---"
echo "Hostname:  $(hostname)"
echo "OS:        $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo "Public IP: $(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo unknown)"
echo "Uptime:    $(uptime -p 2>/dev/null || uptime)"

echo
echo "--- Memory and disk ---"
free -h
echo
df -h / | tail -1
echo
if swapon --show | grep -q .; then
  echo "Swap: present"
  swapon --show
else
  echo "Swap: NONE — a 1GB server needs swap to build the front end"
fi

echo
echo "--- Web server ---"
if command -v nginx >/dev/null 2>&1; then
  echo "nginx: installed ($(nginx -v 2>&1 | cut -d/ -f2))"
  echo "Enabled sites:"
  ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/  /' || echo "  none"
  echo "Domains currently served:"
  grep -rhE "^\s*server_name" /etc/nginx/sites-enabled/ 2>/dev/null \
    | sed 's/^\s*server_name\s*//; s/;//' | tr ' ' '\n' | grep -v '^$' | sort -u | sed 's/^/  /' \
    || echo "  none found"
else
  echo "nginx: not installed"
fi
if command -v apache2 >/dev/null 2>&1 && systemctl is-active --quiet apache2; then
  echo
  echo "WARNING: Apache is running and will conflict with nginx on port 80."
fi

echo
echo "--- Databases ---"
if command -v mysql >/dev/null 2>&1; then
  echo "MySQL/MariaDB: installed"
  systemctl is-active --quiet mysql && echo "  status: running" || echo "  status: not running"
  echo "  existing databases:"
  mysql -NBe "SHOW DATABASES" 2>/dev/null \
    | grep -vE '^(information_schema|performance_schema|mysql|sys)$' \
    | sed 's/^/    /' || echo "    (could not list — may need a password)"
else
  echo "MySQL: not installed"
fi

echo
echo "--- What is listening ---"
ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | sed 's/^/  /' | head -20

echo
echo "--- Port 4000 (Pazo needs this) ---"
if ss -tln 2>/dev/null | grep -q ':4000 '; then
  echo "  IN USE — Pazo will need a different port"
  ss -tlnp 2>/dev/null | grep ':4000 '
else
  echo "  free"
fi

echo
echo "--- Other services ---"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null \
  | awk '{print $1}' \
  | grep -vE '^(systemd|dbus|cron|ssh|rsyslog|polkit|networkd|resolved|udev|getty|user@|logind|timesyncd|snapd|multipathd|unattended)' \
  | sed 's/^/  /' | head -20

echo
echo "--- Node.js ---"
command -v node >/dev/null 2>&1 && echo "  node $(node --version)" || echo "  not installed"
command -v pm2 >/dev/null 2>&1 && echo "  pm2 is installed — another app may be managed by it" || true

echo
echo "--- Firewall ---"
ufw status 2>/dev/null | head -12 | sed 's/^/  /' || echo "  ufw not installed"

echo
echo "--- Existing certificates ---"
if [ -d /etc/letsencrypt/live ]; then
  ls -1 /etc/letsencrypt/live/ 2>/dev/null | grep -v README | sed 's/^/  /' || echo "  none"
else
  echo "  none"
fi

echo
echo "================================================"
echo " Copy everything above and send it back."
echo "================================================"
echo
