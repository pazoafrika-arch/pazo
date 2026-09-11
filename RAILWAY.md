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
JWT_ACCESS_SECRET=<a long random string>
JWT_REFRESH_SECRET=<a different long random string>
ADMIN_EMAIL=you@pazo.co.tz
ADMIN_PASSWORD=SomethingStrong2026
ADMIN_NAME=Your Name
CLICKPESA_BASE_URL=https://api.clickpesa.com/third-parties
CLICKPESA_CLIENT_ID=
CLICKPESA_API_KEY=
CLICKPESA_CHECKSUM_KEY=
```

The admin account is created automatically on first boot from those three
`ADMIN_*` values.

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

## Your admin account

It creates itself. Include these in the variables at step 5:

```
ADMIN_EMAIL=you@pazo.co.tz
ADMIN_PASSWORD=SomethingStrong2026
ADMIN_NAME=Your Name
```

On the first boot the account is created; on every boot after that it is left
alone. Sign in, change the password, then delete `ADMIN_PASSWORD` from the
variables so it is not sitting in the dashboard.

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
