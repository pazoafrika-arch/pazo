# Deploying to Railway

The whole product runs as **one service on one URL**: the API serves the built
web app, so there is nothing to wire together.

---

## What you click

### 1. Sign in
Go to **railway.com** and sign in with **GitHub**. Authorise it to read your
repositories.

### 2. Create the project
- **New Project** → **Deploy from GitHub repo**
- Pick **pazoafrika-arch/pazo**
- Railway starts building immediately. Let it.

### 3. Add the database
- In the project, click **+ Create** → **Database** → **Add MySQL**
- Railway provisions it and sets `DATABASE_URL` automatically.

### 4. Connect the database to the app
- Click your **app service** (not the database) → **Variables**
- **+ New Variable** → **Add Reference** → choose **MySQL → DATABASE_URL**

### 5. Add the remaining variables
Still under **Variables**, click **Raw Editor** and paste:

```
NODE_ENV=production
OTP_DEV_ECHO=false
JWT_ACCESS_SECRET=<paste a long random string>
JWT_REFRESH_SECRET=<paste a different long random string>
CLICKPESA_BASE_URL=https://api.clickpesa.com/third-parties
CLICKPESA_CLIENT_ID=
CLICKPESA_API_KEY=
CLICKPESA_CHECKSUM_KEY=
```

For the two secrets, use any long random text — 40+ characters each, and
different from one another.

### 6. Get your URL
- **Settings** → **Networking** → **Generate Domain**
- You get something like `pazo-production.up.railway.app`

### 7. Point the app at itself
Back in **Variables**, add:

```
APP_URL=https://your-generated-domain.up.railway.app
```

Railway redeploys. When it finishes, open the URL.

---

## Creating your admin account

The deployment starts with an empty database. To create your first admin,
open the **MySQL** service → **Data** tab → **Query**, and run:

```sql
INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
VALUES (
  UUID(),
  'you@pazo.co.tz',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYGBLiVjkLZ3Muq',
  'super_admin', 'active', 'Your Name', '#007b84', 1
);
```

That password hash is `Admin2026!`. **Sign in and change it immediately.**

---

## Demo data (optional)

To show the platform with realistic data, add a variable `SEED_ON_BOOT=true`,
redeploy once, then remove it. Demo accounts use published passwords, so remove
them before real users arrive.

---

## Adding your own domain

**Settings** → **Networking** → **Custom Domain** → enter e.g.
`partners.pazo.africa`. Railway shows a CNAME record to add at your registrar.
HTTPS is automatic.

---

## ClickPesa

Once you have credentials, set the three `CLICKPESA_*` variables and point the
ClickPesa portal's webhook at:

```
https://your-domain/api/v1/webhooks/clickpesa
```

---

## Cost

Roughly **$5–10/month** for the app plus MySQL at low traffic. Railway bills by
usage, and includes $5 of credit on the free tier.

---

## If a deploy fails

**Deployments** tab → click the failed build → read the log. The usual causes:

| Message | Fix |
| --- | --- |
| `ECONNREFUSED` to the database | `DATABASE_URL` reference not added (step 4) |
| Healthcheck failed | Check the deploy log for the real error above it |
| Build out of memory | Rare on Railway; retry the deploy |
