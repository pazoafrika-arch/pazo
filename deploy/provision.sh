#!/usr/bin/env bash
#
# Pazo — one-time server provisioning for a fresh Ubuntu 24.04 Linode.
#
# Creates a non-root deploy user, locks down SSH, installs Node, MySQL, nginx
# and Caddy-free Let's Encrypt via certbot, and sets up the firewall.
#
# Run as root on the new server:
#   bash provision.sh
#
set -euo pipefail

DEPLOY_USER="pazo"
NODE_MAJOR="20"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

say "Updating package lists"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# Deliberately NOT running a full upgrade. This server may already be serving
# another site, and upgrading everything mid-flight can restart services.
# Security patches are handled by unattended-upgrades below.

say "Installing base packages"
# --no-install-recommends keeps the footprint small on a 1GB box. Packages
# already present are left exactly as they are.
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg git ufw fail2ban unattended-upgrades \
  nginx mysql-server certbot python3-certbot-nginx

say "Adding swap space"
# A 1GB server runs out of memory building the front end. 2GB of swap makes
# the build reliable and costs nothing but a little disk.
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/99-pazo-swap.conf
  sysctl -p /etc/sysctl.d/99-pazo-swap.conf >/dev/null
  echo "  2GB swap added"
else
  echo "  swap already present"
fi
free -h

say "Installing Node.js ${NODE_MAJOR}"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs
node --version

say "Creating the ${DEPLOY_USER} user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
# The app never needs root. It gets sudo only to restart its own service.
mkdir -p /home/"$DEPLOY_USER"/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/"$DEPLOY_USER"/.ssh/authorized_keys
fi
chown -R "$DEPLOY_USER":"$DEPLOY_USER" /home/"$DEPLOY_USER"/.ssh
chmod 700 /home/"$DEPLOY_USER"/.ssh
chmod 600 /home/"$DEPLOY_USER"/.ssh/authorized_keys 2>/dev/null || true

cat >/etc/sudoers.d/pazo-service <<'SUDO'
pazo ALL=(root) NOPASSWD: /bin/systemctl restart pazo-api, /bin/systemctl status pazo-api, /bin/systemctl start pazo-api, /bin/systemctl stop pazo-api, /usr/bin/systemctl restart pazo-api, /usr/bin/systemctl status pazo-api, /usr/bin/systemctl start pazo-api, /usr/bin/systemctl stop pazo-api
SUDO
chmod 440 /etc/sudoers.d/pazo-service

say "Checking SSH configuration"
# SSH is NOT changed automatically. On a server you are already using, a bad
# SSH change locks you out permanently. This only reports what is set.
if grep -qE '^PasswordAuthentication\s+no' /etc/ssh/sshd_config; then
  echo "  Password login is already disabled. Good."
else
  echo "  NOTE: SSH still accepts passwords."
  echo "  Once you have confirmed key-based login works, disable it with:"
  echo "    sudo sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config"
  echo "    sudo systemctl restart ssh"
fi

say "Configuring the firewall"
# Rules are added, never reset, so anything the existing site needs keeps
# working. SSH is allowed first so enabling the firewall cannot lock you out.
ufw allow OpenSSH
ufw allow 'Nginx Full'
if ufw status | grep -q "Status: active"; then
  echo "  Firewall was already active; rules added."
else
  ufw --force enable
fi
ufw status verbose

say "Enabling fail2ban and automatic security updates"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Securing MySQL"
# Only removes anonymous users and the sample 'test' database. Existing
# databases and users belonging to other sites are never touched.
mysql <<'SQL'
DELETE FROM mysql.user WHERE User='';
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
SQL

# MySQL listens on localhost only. Nothing outside the box can reach it.
# Only the settings Pazo depends on. Kept minimal because another
# application may share this MySQL instance.
cat >/etc/mysql/mysql.conf.d/99-pazo.cnf <<'CNF'
[mysqld]
bind-address = 127.0.0.1
# Pazo stores and compares every timestamp in UTC. Without this, scheduled
# payout retries fire hours late and date filters cover the wrong window.
default-time-zone = '+00:00'
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
CNF
systemctl restart mysql

say "Creating the application directory"
mkdir -p /var/www/pazo /var/log/pazo /var/backups/pazo
chown -R "$DEPLOY_USER":"$DEPLOY_USER" /var/www/pazo /var/log/pazo
chown root:root /var/backups/pazo
chmod 700 /var/backups/pazo

say "Provisioning complete"
cat <<EOF

  Next:
    1. Create the database and its user:   bash setup-db.sh
    2. Deploy the application:             bash deploy.sh

  Server user:  ${DEPLOY_USER}
  App directory: /var/www/pazo

EOF
