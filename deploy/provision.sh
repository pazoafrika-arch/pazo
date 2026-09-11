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

say "Updating the system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

say "Installing base packages"
apt-get install -y \
  curl ca-certificates gnupg git ufw fail2ban unattended-upgrades \
  nginx mysql-server certbot python3-certbot-nginx

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

say "Hardening SSH"
# Key-only login, no root shell. Assumes your key is already installed.
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd

say "Configuring the firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

say "Enabling fail2ban and automatic security updates"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Securing MySQL"
# mysql_secure_installation is interactive; do the same work directly.
mysql <<'SQL'
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost','127.0.0.1','::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
SQL

# MySQL listens on localhost only. Nothing outside the box can reach it.
cat >/etc/mysql/mysql.conf.d/99-pazo.cnf <<'CNF'
[mysqld]
bind-address = 127.0.0.1
# The application stores and compares every timestamp in UTC.
default-time-zone = '+00:00'
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
max_connections = 200
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
