# Deploy to Railway (from your GitHub repository)

This is the simplest way to get the Souvari system online: Railway builds the
project from a root `Dockerfile` and auto-deploys on every `git push` to GitHub.

Estimated cost: **P300–900/month ($5–15)**, Hobby plan, always-on.

---

## 1. Push the code to GitHub

Your repo must be on GitHub (the deploy kit elsewhere in this folder already
clones it as `https://github.com/kurtpogi272-arch/souvari-skin-lab`).
Make sure `Dockerfile` and `railway.toml` at the repo root are pushed too.

## 2. Create the Railway project

1. Sign in at https://railway.app (GitHub sign-in is fine).
2. **New Project → Deploy from GitHub** → authorize Railway → select the repo.
3. Railway reads `railway.toml` → uses the `Dockerfile` automatically (do NOT
   change the builder; do not use Nixpacks).
4. The first deploy will fail to finish until the database is added below.

## 3. Add MySQL

1. In the project canvas click **+ New → Database → MySQL** (MySQL 8).
2. Open the MySQL service → **Variables** tab. It exposes connection values
   (e.g. `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`,
   `MYSQL_DATABASE`, or a ready `MYSQL_URL`).
3. On your **web service → Variables**, add:
   ```
   DATABASE_URL=mysql://<MYSQLUSER>:<MYSQLPASSWORD>@<MYSQLHOST>:<MYSQLPORT>/<MYSQL_DATABASE>
   ```
   (Use the internal host that Railway lists — it looks like `mysql.railway.internal`.)

## 4. Set the rest of the environment variables

On the **web service → Variables** tab add:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | from step 3 |
| `JWT_ACCESS_SECRET` | random hex (see below) |
| `JWT_REFRESH_SECRET` | a DIFFERENT random hex (see below) |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `FRONTEND_URL` | your live URL (Railway URL or custom domain) |
| `BACKEND_URL` | same as FRONTEND_URL (same origin) |
| `AI_API_KEY` | your real Gemini key (blank = built-in engine) |
| `AI_MODEL` | `gemini-3.1-flash-lite` |
| `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `SMS_PROVIDER` | `mock` to disable, or `semaphore` / `textbee` |
| `SMS_API_KEY` | needed only if a real SMS provider is used |
| `SMS_SENDER` | `SOUVARI` (≤11 chars, must be Semaphore-approved) |
| `TEXTBEE_DEVICE_ID` | needed only for TextBee |
| `REMINDERS_ENABLED` | `true` |
| `REMINDER_RUN_HOUR` | `8` |
| `TZ` | `Asia/Manila` |
| `MAIL_HOST` | SMTP hostname, e.g. `smtp.gmail.com` |
| `MAIL_PORT` | `587` for STARTTLS or `465` for implicit TLS |
| `MAIL_USER` | authenticated sender email address |
| `MAIL_PASS` | SMTP password (a Gmail app password when using Gmail) |
| `MAIL_FROM_NAME` | `Souvari Skin Lab` |

Generate secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 5. Deploy

Click **Deploy** and wait. The container:

1. Runs `prisma migrate deploy` on every start (safe, non-destructive; on an
   empty database this applies all migrations).
2. Starts `node dist/server.js`, which serves the API **and** the built
   frontend (SPA, with client-side routing fallback) on one origin.

Railway's health check hits `/api/health`. When the deploy shows **Healthy**,
open your service URL (`https://<service>.up.railway.app`) — you should see the
Souvari login page.

### Customer forgot-password email OTP

The login page links to `/forgot-password`. Recovery is restricted to active,
non-deleted **customer** accounts; staff and admin accounts cannot reset through
these endpoints. The Contact form and password recovery share the SMTP settings
listed above. Enter credentials in Railway Variables, not in source control.

The `20261023150000_add_customer_password_reset` migration adds a bounded
one-request-per-user table and `users.auth_version`. The Docker startup applies
it through `prisma migrate deploy`; confirm it succeeds before testing the new
authentication code. For a manual/local deployment:

```bash
npm run db:generate --prefix server
npm exec --prefix server -- prisma migrate deploy --schema server/prisma/schema.prisma
npm run build --prefix server
npm run build --prefix client
```

Recovery behaviour:

- Email OTP: six digits, valid for 10 minutes, at most five incorrect attempts.
- Resend: at least 60 seconds between emails for a customer; a resend replaces
  the previous OTP and any pending reset token.
- Request limit: five requests per IP per 15 minutes; verification/reset limit:
  30 requests per IP per 15 minutes (in-memory limits per running app instance).
- Verified reset session: valid for 10 minutes, single use. OTPs and reset
  tokens are stored only as hashes; they are never returned by the request-code
  endpoint or written to logs. The verification endpoint returns only the
  short-lived reset token, held in page memory.
- A successful password reset invalidates that customer's existing access and
  refresh tokens. The customer signs in again with the new password.

After deployment, test with an active customer email you control: request an
OTP, confirm inbox/spam receipt, verify the code, reset the password, and sign in.
Do not test using a real customer's account without their involvement. If email
cannot be sent, verify SMTP credentials and outbound SMTP connectivity from the
Railway service; a successful local SMTP check does not confirm Railway delivery.

## 6. Seed data (one time only)

Open the **web service → Shell** tab (working dir `/app/server`) and run:

```bash
npm run db:seed:all
npm run db:verify:catalog
```

This creates the admin/staff accounts, catalog, memberships, loyalty levels,
employees and service-staff assignments. Do NOT re-run it routinely.

## 7. Custom domain (optional)

The free `*.up.railway.app` URL works for real use. To use your cloudflare
domain later:

1. Web service → **Settings → Networking → Custom Domain** → add `clinic.yourdomain.com`.
2. In the Cloudflare dashboard (DNS), point `clinic` at the hostname/IP Railway
   shows (use a CNAME/proxy or an A record as Railway instructs — keep DNS on
   "DNS only" if Railway provides its own cert).
3. Git push to `master` → Railway auto-redeploys (watch paths are set in
   `railway.toml`).

## 8. Keep it awake & budget

- The 8 AM reminder batch runs inside the web service, so keep it **always on**
  — do not enable scale-to-zero/sleeping.
- Hobby plan ($5/mo) includes a $5 usage credit. This app + small MySQL usually
  stays within a few more dollars per month. The cost-control page warns you
  before overspending.

## 9. Backups

Railway's MySQL is a container with a volume — enable its **one-click daily
backups** in the MySQL service settings (database tab), or add a nightly
`mysqldump` cron job later. Keep an occasional manual export too:

```bash
# from the MySQL service shell
mysqldump -u <user> -p<pass> <database> > /backups/souvari-$(date +%F).sql
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "tsc: not found" (Cloudflare-style Nixpacks build) | Ensure the builder is **DOCKERFILE** (railway.toml already pins it). Do not use Nixpacks. |
| Deploy unhealthy / API down | Check the web service **Logs**; most likely `DATABASE_URL` is wrong (must be the internal MySQL host, and DB must be reachable). |
| `migrate deploy` fails P3005 (schema not empty) | Only happens if you pointed it at a NON-empty DB that wasn't created by these migrations. On the fresh Railway MySQL this does not occur. |
| Chatbot says it has "no information on file" for products/prices after a snapshot import | The snapshot can carry duplicate phone numbers, which makes the `add_unique_user_phone` migration fail and silently skip every migration after it (including the product-content columns). The container now runs the `prisma/predeploy*.sql` scripts before migrating to clear the duplicates automatically — just redeploy. If the columns are still missing the chatbot now falls back to answering without them instead of refusing, and logs `[chat] products table is missing purpose/benefits columns`. To fix an already-running instance by hand, see the MySQL console note below. |
| 404 on page refresh | Should not happen — the container includes SPA fallback. If you've swapped the builder, verify you're hitting the Docker image. |
| Reminders not sent at 8 AM | Check `TZ=Asia/Manila`, `REMINDERS_ENABLED=true`, and that the service never sleeps. |

### Fix the stale-schema chatbot without a redeploy

If you can't redeploy immediately, open the **MySQL service → Console** and run the same preflight by hand, then restart the web service so migrations finish:

```sql
-- Clear a half-applied migration marker, if any.
UPDATE _prisma_migrations
SET rolled_back_at = NOW()
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

-- Clear duplicate phone numbers (lowest id keeps it) so the unique index builds.
UPDATE users AS u
JOIN (
  SELECT phone AS dup_phone, MIN(id) AS keep_id
  FROM users
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY phone
  HAVING COUNT(*) > 1
) AS d ON u.phone = d.dup_phone AND u.id <> d.keep_id
SET u.phone = NULL;
```

Then restart the web service (it runs `migrate deploy` on boot). The product-content columns will be added and the chatbot's product answers will work.

---

Why NOT cloudflare pages (for the record): Cloudflare Pages is static-only —
it cannot run Express, connect to MySQL over TCP, or keep the reminder scheduler
alive. Use Cloudflare only for the domain's DNS. Railway (or a VPS) must run the
app itself.
