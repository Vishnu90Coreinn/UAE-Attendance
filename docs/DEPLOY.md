# Production deployment: Windows Server + IIS on AWS

One IIS site serves everything: the API under `/api` and the web app (React build) at `/`. There is no separate web
server and no CORS to configure. The web app is installable on phones, which needs **HTTPS**; terminate it on an AWS
Application Load Balancer (ALB) or on IIS itself.

```
phones / browsers --HTTPS--> ALB --HTTP--> IIS (ASP.NET Core Module) --> HrPayroll.Api --> SQL Server (RDS or EC2)
```

## 1. What you need

- Windows Server 2022 EC2 instance with the **IIS** role (Web Server) installed
- **.NET 10 Hosting Bundle** (installs the ASP.NET Core Module; restart IIS after installing: `iisreset`)
- SQL Server reachable from the instance (Amazon RDS for SQL Server, or SQL Server on EC2)
- A domain name and an ACM certificate for the ALB (HTTPS)

## 2. Build the release

CI builds it on every push to `master` (GitHub Actions artifact `hr-payroll-iis`). To build locally:

```powershell
./scripts/publish-iis.ps1          # writes artifacts/iis
```

The folder contains the API, its `web.config` for IIS and the web app in `wwwroot`. It contains no secrets and no
development settings.

## 3. Database

1. Create an empty database (for example `HrPayroll`) and a dedicated SQL login with rights on that database only.
2. Apply the migrations from a machine with the .NET SDK and network access to the database:

```powershell
$env:ConnectionStrings__Default = "<production connection string>"
dotnet ef database update --project apps/api
```

   Or skip this step: with `Database:MigrateOnStartup` set to `true` in `appsettings.Production.json`, the site applies pending migrations itself on every start, so a deploy updates the schema automatically. Take a database backup before releasing migrations that drop or change data.

## 4. Configure the server

Settings are environment variables (see `.env.example`). Set them as **machine** variables, or on the application
pool, so they never sit in a file in the site folder:

| Variable | Value |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ConnectionStrings__Default` | `Server=<host>;Database=HrPayroll;User Id=<login>;Password=<password>;Encrypt=True;TrustServerCertificate=False` |
| `Jwt__Key` | a random string of 32+ characters, kept secret (the API refuses to start without it) |
| `Hosting__BehindProxy` | `true` when an ALB sits in front (see "HTTPS and the load balancer") |
| `Seed__AdminUsername`, `Seed__AdminPassword` | first start only; remove both once you have signed in (10-128 characters) |

Generate the signing key once, for example: `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }) -as [byte[]])`.
Changing `Jwt__Key` later signs everyone out.

## 5. Create the IIS site

1. Copy the contents of the release folder to, for example, `C:\inetpub\hr-payroll`.
2. Create an application pool: **.NET CLR version: No Managed Code**, identity `ApplicationPoolIdentity`.
3. Create the site pointing at that folder, bound to port 80 (the ALB handles HTTPS) or to 443 with your certificate.
4. Give the pool identity (`IIS AppPool\<pool name>`) **modify** rights on `C:\inetpub\hr-payroll\logs`; the API writes
   its log files there.
5. Browse to `http://localhost/api/health`. It must return `200` with `{"status":"ok","database":"ok"}`.

## 6. HTTPS and the load balancer

- ALB listener 443 (ACM certificate) forwarding to a target group on port 80; add a 80 -> 443 redirect.
- Target group health check: path `/api/health`, success code `200`.
- Security group: allow port 80 on the instance **only from the ALB's security group**. Then set
  `Hosting__BehindProxy=true`: the API trusts `X-Forwarded-For` and `X-Forwarded-Proto` so the sign-in rate limit sees
  each user's real IP. Never enable it when the instance is reachable directly from the internet.
- The web app caches nothing but an offline page. The entry page, `sw.js` and `manifest.webmanifest` are sent with
  `Cache-Control: no-cache`, hashed files under `/assets` cache for a year; do not override these on the ALB or a CDN.

## 7. First sign-in

With the seed variables set, the first start creates the administrator. Sign in at `https://<your domain>`, change the
password from the account menu, then **remove `Seed__AdminUsername` and `Seed__AdminPassword`** and recycle the pool.

## 8. Automatic deploy on merge (GitHub Actions)

Merging a pull request into `master` runs `.github/workflows/ci.yml`: web checks, API tests, the IIS package, then the
**Deploy to IIS** job. That job runs on a **self-hosted runner installed on the server**, so the server needs no
inbound access from GitHub.

One-time setup:

1. GitHub repo > Settings > Actions > Runners > **New self-hosted runner** (Windows). Follow the commands on the
   server, give it the extra label `hr-payroll-prod`, and install it as a service (`./config.cmd ... --runasservice`).
   The service account needs modify rights on the site folder and permission to write `app_offline.htm` there.
2. Install `pwsh` (PowerShell 7) on the server; the workflow uses it.
3. Repo > Settings > Environments > create **production**. Add required reviewers if you want an approval click before
   each deploy.
4. Repository variables (Settings > Secrets and variables > Actions > Variables): `IIS_SITE_PATH` if the site is not at
   `C:\inetpub\hr-payroll`, and `IIS_HEALTH_URL` (for example `http://localhost:8080/api/health`) if the site is not on
   port 80 or needs a host name.

The job copies the release over the site (keeping `logs`), shows `app_offline.htm` meanwhile and fails the run if
`/api/health` does not return `database: ok`. With `Database:MigrateOnStartup` on, the site applies new migrations when it starts after the deploy. Re-run a deploy from Actions > CI > Run workflow.

## 9. Releasing an update by hand

1. Take a database backup (RDS snapshot or `BACKUP DATABASE`).
2. Apply any new migrations (step 3).
3. Put `app_offline.htm` in the site folder (IIS stops the app and releases its files), copy the new release over the
   old one (keep the `logs` folder), then delete `app_offline.htm`.
4. Check `/api/health` and sign in.

**Rollback:** redeploy the previous release folder. Migrations are forward-only, so restore the backup if a migration
must be undone.

## 10. Operations

- Logs: `C:\inetpub\hr-payroll\logs\hrpayroll-*.log` (daily files). Every request line carries a correlation id.
- Back up the database daily and test a restore. The finalised payroll months live there.
- Sign-in is limited to 10 attempts per IP per minute (`RateLimiting__LoginPerMinute`) and an account locks for 15
  minutes after five wrong passwords.
