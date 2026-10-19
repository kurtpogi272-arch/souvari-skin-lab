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