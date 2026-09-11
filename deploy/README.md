# Deploying Pazo to Linode

Six commands on the server, plus a few things only you can do (create the
Linode, point DNS, paste keys).

**Total time:** about 30 minutes, most of it waiting for DNS.

---

## What you do first

### 1. Create the Linode

In the Linode dashboard: **Create → Linode**

| Setting | Choose |
| --- | --- |
| Image | **Ubuntu 24.04 LTS** |
| Region | **Frankfurt** or **London** (closest to Tanzania with good latency) |
| Plan | **Shared CPU → Linode 2GB** ($12/month) |
| Label | `pazo-production` |
| Root password | Generate a strong one and save it |
| SSH key | **Add your public key** — see below if you do not have one |

2GB is comfortable for launch. Resizing later is a few clicks and a reboot.

**If you have no SSH key**, run this on your Windows machine first:

```bash
ssh-keygen -t ed25519 -C "pazo"
cat ~/.ssh/id_ed25519.pub
```

Paste that output into the SSH key field.

### 2. Point your domain at it

Copy the Linode's IP address. At your domain registrar, add an **A record**:

| Type | Name | Value |
| --- | --- | --- |
| A | `partners` (or `@` for the bare domain) | your Linode IP |

DNS takes 5 to 60 minutes. Carry on while it propagates.

### 3. Push the code to GitHub

From this project folder on your machine:

```bash
git init
git add .
git commit -m "Pazo partner platform"
git branch -M main
git remote add origin https://github.com/pazoafrika-arch/pazo.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules` and `dist`, so no secrets
are committed.

Because the repo is private, the server needs read access. Simplest way: create
a **fine-grained personal access token** (GitHub → Settings → Developer settings
→ Personal access tokens) with **Contents: Read-only** on this one repo. You
will paste it once when the server clones.

---

## What runs on the server

SSH in:

```bash
ssh root@YOUR_LINODE_IP
```

Then, in order:

```bash
# 1. Get the deploy scripts (you will be asked for the GitHub token)
git clone https://github.com/pazoafrika-arch/pazo.git /tmp/pazo-deploy
cd /tmp/pazo-deploy/deploy

# 2. Provision: users, firewall, Node, MySQL, nginx  (~5 min)
bash provision.sh

# 3. Create the database and its user
bash setup-db.sh

# 4. Deploy the app — asks for your domain
bash deploy.sh

# 5. Turn on HTTPS — needs DNS to have propagated
bash enable-https.sh partners.yourdomain.com you@email.com

# 6. Nightly backups
bash setup-backups.sh

# 7. Check everything
bash preflight.sh
```

`preflight.sh` tells you plainly what is safe and what is not. Fix anything
marked FAIL before letting real users in.

---

## After it is live

### Create your real admin account

The seed data is for demos. For a real launch, do **not** run `npm run seed`.
Create one admin instead:

```bash
cd /var/www/pazo/server
sudo -u pazo node -e "
import('./src/utils/crypto.js').then(async (c) => {
  const { execute } = await import('./src/db/pool.js');
  const id = c.uuid();
  await execute(
    \`INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
     VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, 1)\`,
    [id, 'you@pazo.co.tz', await c.hashPassword('ChangeThisNow123'), 'Your Name', '#007b84'],
  );
  console.log('Admin created. Sign in and change the password immediately.');
  process.exit(0);
});
"
```

Then sign in at `https://partners.yourdomain.com/login` and change that password.

### Add your ClickPesa keys

```bash
sudo nano /var/www/pazo/server/.env
# fill in CLICKPESA_CLIENT_ID, CLICKPESA_API_KEY, CLICKPESA_CHECKSUM_KEY
sudo systemctl restart pazo-api
```

In the ClickPesa portal, set the webhook URL to:

```
https://partners.yourdomain.com/api/v1/webhooks/clickpesa
```

### Give The Travela their API key

Sign in as admin → **Businesses** → create or open The Travela → **Regenerate
API key**. It is shown once. Send it to their developer securely, along with
`README.md` in the project root, which documents both integration endpoints.

---

## Day-to-day

```bash
# Deploy an update after pushing to GitHub
cd /tmp/pazo-deploy/deploy && sudo bash deploy.sh

# Watch the logs
sudo journalctl -u pazo-api -f

# Restart the API
sudo systemctl restart pazo-api

# Check health
curl https://partners.yourdomain.com/health

# Back up right now
sudo /usr/local/bin/pazo-backup

# Restore from a backup
gunzip < /var/backups/pazo/pazo-20260911-0215.sql.gz | sudo mysql pazo
```

---

## What this setup gives you

**Security.** Key-only SSH, firewall allowing just HTTP, HTTPS and SSH, MySQL
bound to localhost, fail2ban against brute force, automatic security updates,
the app running as a non-root user under a restricted systemd sandbox, and
secrets in a 600-permission file that is never committed.

**Reliability.** The API restarts automatically if it crashes or the server
reboots. Nightly database backups with 30-day retention, verified after each
dump. Certificates renew themselves.

**Correctness.** MySQL is pinned to UTC at the server level, matching what the
application writes. Getting this wrong causes scheduled payout retries to fire
late and date filters to cover the wrong window.

---

## One thing to sort out soon

The backups sit on the same server as the database. If the server is lost, so
are they. Copy them somewhere else — Linode Object Storage is a few dollars a
month — or at minimum pull them down periodically:

```bash
scp root@YOUR_LINODE_IP:/var/backups/pazo/pazo-*.sql.gz ./local-backups/
```

Also worth enabling **Linode Backups** on the instance itself ($2.50/month at
this plan size) for whole-server restore.

---

## If something is wrong

| Symptom | Check |
| --- | --- |
| Site does not load | `sudo systemctl status nginx` and `sudo nginx -t` |
| API errors | `sudo journalctl -u pazo-api -n 50` |
| Database errors | `sudo systemctl status mysql` |
| Certificate failed | DNS has not propagated. Confirm with `getent hosts yourdomain.com`, then re-run `enable-https.sh` |
| Webhooks not arriving | ClickPesa needs HTTPS and a publicly reachable URL. Confirm `curl https://yourdomain.com/api/v1/webhooks/clickpesa` returns JSON |
| Payouts stuck queued | Admin → Payouts → Agent withdrawals. Check the gateway is configured and the daily cap is not reached |
