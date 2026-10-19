# Getting Souvari online with Cloudflare (stable URL, own domain)

Goal: expose the app already running on the **clinic Windows PC** as a permanent
`https://souvari-skin-lab.site` using a **Cloudflare named tunnel**. Hosting stays
$0 (your own PC + Cloudflare free plan); the only cost is the domain (~$10-16/yr).

> **Do not use Cloudflare Pages for this app.** Pages only serves static files and
> edge Functions — it has no Node runtime or MySQL, so the API (`/api/*`) and the
> chatbot cannot run there. A Pages deploy of the frontend will either fail to
> build (the repo root install does not install `client/` dependencies) or serve a
> site whose API calls 404. Use the **named tunnel** below, which serves the UI and
> the API from the same origin with no CORS or API-URL changes.
>
> If you already created a Pages project: delete it (or leave it unused) and
> remove the domain from **Pages → Custom domains** before routing the tunnel, so
> the tunnel's DNS `CNAME` is not fought over by the Pages project.

## What changed in the repo (already done)

- `server/src/app.ts` now serves the built React app (`client/dist`) and falls
  back to `index.html` for client routes (e.g. `/admin/calendar`), so **one
  Node process hosts the UI + API on the same origin**. Unknown `/api/*` still
  return JSON 404. In dev (no `client/dist`) it is skipped, so `npm run dev`
  behaves exactly as before.
- Fixed the 5 pre-existing TypeScript errors + a declaration-emit error so
  `npm run build` in `server/` exits cleanly (previously it emitted `dist` but
  failed with exit code 1 - a deploy script would have aborted).
- `server/src/app.ts` sets `app.set('trust proxy', 1)` so that behind the
  Cloudflare Tunnel the rate limiter accepts `X-Forwarded-For` (without it,
  `express-rate-limit` errors with `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`) and
  `req.ip` logs the real client instead of the proxy.
- `setup-server.bat` runs the same idempotent migration preflights as the
  Dockerfile (`predeploy.sql`, `predeploy-migrations.sql`, two `migrate resolve`
  calls) then retries `prisma migrate deploy` up to 5 times. A snapshot import
  or a half-applied migration can no longer abort setup.

## Prerequisites (on the clinic PC)

Run **`check-prereqs.bat`** (as Administrator) to see what is missing. It needs:

- Windows 10/11.
- **Git** for Windows (git-scm.com).
- **Node 20.11+ LTS** (nodejs.org or nvm-windows). Verify with `node -v`.
- **MySQL 8** running, with an `iave_clinic` database. `setup-server.bat` can
  create the schema, but MySQL itself must be installed and running first.
  - Install with the **MySQL Installer for Windows**
    (https://dev.mysql.com/downloads/installer/) -> choose *MySQL Server 8.0*.
    Set a root password and keep the default port `3306`.
  - Or, with Chocolatey: `choco install mysql` (run the shell as Administrator).
  - Create the database once (adjust the path to your MySQL version):
    ```
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "CREATE DATABASE IF NOT EXISTS iave_clinic CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
    ```
  - Verify the service exists: `sc query MySQL80` (or `MySQL` / `MySQL57`).
- A Cloudflare account.
- Internet/outbound access (Cloudflare Tunnel works behind NAT; no router
  changes needed).

## Step 1 - The domain (already done)

`souvari-skin-lab.site` is already registered through Cloudflare Registrar, so its
DNS zone lives on Cloudflare and is ready. Nothing to buy. Confirm in the
dashboard that the zone shows as **Active**, then continue.

1. Log in at dash.cloudflare.com.
2. Select the `souvari-skin-lab.site` zone; make sure its status is **Active**.
3. Skip the "changes detected" warnings - we add DNS below via the tunnel.

## Step 2 - Deploy the code + server (one batch)

1. Copy the `deploy/cloudflare-clinic/` folder to `C:\clinic\` on the clinic PC.
2. Right-click **setup-server.bat** -> **Run as administrator**.
   - It clones/pulls `https://github.com/Kurt-De-Asis/souvari-skin-lab-cms.git`
     to `C:\clinic\souvari-skin-lab-cms`, installs deps, builds, runs
     `prisma migrate deploy`, and starts the API under **PM2**.
   - When it pauses, edit `C:\clinic\souvari-skin-lab-cms\server\.env`:
     - `DATABASE_URL` -> your real MySQL password.
     - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` -> two random hex strings
       (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
     - `FRONTEND_URL` / `BACKEND_URL` -> `https://souvari-skin-lab.site`.
     - `TZ=Asia/Manila` so the 8 AM reminder batch fires at local time.
     - `SMS_PROVIDER=semaphore` + `SMS_API_KEY` + `SMS_SENDER` when you want
       real texts (leave `mock` for now).
   - It registers an on-login start task, so the server comes back after a
     reboot.
3. Check it locally: on that PC browse `http://localhost:3000` - you should see
   the login page, and `pm2 list` should show `souvari-api` online.

## Step 3 - Cloudflare tunnel (dashboard-managed)

> **Status: the tunnel already exists.** `souvari` (ID
> `893c7198-a3b8-4301-ae71-87af8b9a8596`) was created in the Cloudflare dashboard
> and its connector is already installed/running on the clinic PC
> (`cloudflared.exe service install <token>`). The one thing still missing is the
> **Published application route** below - without it the hostname returns error
> 1033 and does not resolve. Add it under **Networks -> Tunnels -> souvari ->
> Routes**.

Install `cloudflared` on the clinic PC first:
- `choco install cloudflared`, or download `cloudflared-windows-amd64.exe`
  from https://github.com/cloudflare/cloudflared/releases and put it in PATH.

Then, in the Cloudflare dashboard (this creates both the tunnel **and** its
DNS record, so no `config.yml` and no `cloudflared tunnel login` are needed):

1. Go to **Zero Trust** (one.dash.cloudflare.com) -> **Networks** -> **Tunnels**.
2. Select the existing tunnel `souvari` (or **Create a tunnel** ->
   **Cloudflared** -> name it `souvari` -> **Create**).
3. Under **Routes**, add **two** Published applications, both pointing at the app:
   - Hostname: `www.souvari-skin-lab.site` -> Service URL `http://localhost:3000`
   - Hostname: `souvari-skin-lab.site` (the apex) -> Service URL `http://localhost:3000`

   Both are needed. A route creates the DNS record for that exact hostname, so
   adding only `www` leaves the bare `souvari-skin-lab.site` with no record (it
   will not resolve). Cloudflare flattens the apex `CNAME` automatically.
4. If you are creating a new tunnel, copy the **token** shown on the install
   screen, then run **setup-tunnel.bat** (as Administrator) and paste it.
   If the connector is already installed, you can skip this.
5. Confirm the tunnel shows **HEALTHY** in the dashboard and the service is
   **Running** (`sc query cloudflared` / `services.msc` -> `Cloudflare Tunnel Agent`).

> Why not `cloudflared tunnel login` + `tunnel create` + `route dns`? That is the
> locally-managed flow and it also requires a `config.yml` plus a registry edit
> to serve a hostname from a Windows service. The dashboard-managed flow above
> does all of that for you and is what Cloudflare recommends.

## Step 4 - Cut over + checks

1. Open `https://souvari-skin-lab.site/api/health` -> expect the health JSON.
2. Log in at `https://souvari-skin-lab.site` with the admin account.
3. Book an appointment end-to-end (or at least browse services + booking page).
4. Next 8 AM, check the API log shows `[REMINDER] Batch complete:
   ... reminded, ... failed`. (`pm2 logs souvari-api`)
5. If desired, enable SMS now (see `.env` note above) and restart:
   `pm2 restart souvari-api`.

## Security - do this before telling anyone the URL

- The seeded demo admin/staff accounts are now on the public internet.
  **Change the admin password** (and any staff/customer demo passwords) first.
- The AI key lives only in `server\.env` - never put it in the client.
- Consider Cloudflare WAF rules (dashboard, free plan) / restricting access if
  only the clinic team should reach it yet.

## Backups (Cloudflare is a tunnel - it does NOT back up your data)

1. Edit the `MYSQL_BIN` path and `DB_PASS` at the top of `backup-db.bat`.
2. Register a nightly task (run once):
   ```
   schtasks /create /f /tn "SouvariBackup" /sc daily /st 01:30 /tr "\"C:\clinic\backup-db.bat\""
   ```
3. Periodically copy `C:\clinic\backups\` elsewhere (USB/Drive).

## Operations / troubleshooting

| Symptom | Fix |
|---|---|
| `souvari-skin-lab.site` hangs or DNS not resolving | Tunnel must show **HEALTHY** in the dashboard and the `cloudflared` service must be **Running** (`sc query cloudflared`); the Published application route must exist. If a Cloudflare **Pages** project still owns the domain, remove it from Pages → Custom domains. |
| Site shows but API calls fail | `pm2 logs souvari-api`; confirm `server\.env` `FRONTEND_URL`/`BACKEND_URL` = `https://souvari-skin-lab.site`; restart `pm2 restart souvari-api`. |
| PC rebooted, site down | Server restarts on login (task `SouvariServer`); tunnel is a Windows service. Make sure someone logs into Windows, or use a service account. |
| Error 1033 / "tunnel not found" | The tunnel has no published route. Add the Published application route (`souvari-skin-lab.site` and `www.souvari-skin-lab.site` → `http://localhost:3000`) in the dashboard. |
| Error 502 Bad Gateway | The route and tunnel are fine, but the origin is down: nothing is listening on `http://localhost:3000` on the PC running `cloudflared`. Start the app (`pm2 start ecosystem.config.js` / re-run `setup-server.bat`) and check `pm2 list` shows `souvari-api` online; check the Service URL in the route is exactly `http://localhost:3000`. |
| `souvari-skin-lab.site` (apex) doesn't resolve, `www` works | Only the `www` route was added. Add a second Published application route for the apex hostname (a route creates its DNS record). |
| Pages build fails with `tsc: not found` / `vite: not found` | Expected — Pages installs only the repo-root deps. Do not use Pages; use the tunnel. |
| Rate limiter / logs mention `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` | Rebuild the server so `app.set('trust proxy', 1)` is in `dist` (from this repo), then `pm2 restart souvari-api`. |
| `prisma migrate deploy` fails (P3009/P3018, error 1050/1091) | Update the repo, re-run `setup-server.bat` (it runs the preflights + retries). Inspect with `npx prisma migrate status`. Usually a snapshot import left duplicate phones or a half-applied migration; the preflights clear both. |
| Reminders never fire | `REMINDERS_ENABLED=false`? `TZ` not Asia/Manila? Server process off? Check `pm2 logs`. |

## Where this leaves you

This is the "easiest" production shape: one machine, PM2 + cloudflared service,
zero hosting spend. When the clinic eventually wants a dedicated always-on host
outside the clinic PC, the same and code and `dist` bundle deploy to Railway or
a VPS unchanged (the static-serving change is already in place).