# HR & Payroll System

Web application for DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C: worker directory, daily attendance, monthly payroll,
leave management and user access.

React + TypeScript (`apps/web`) · ASP.NET Core Web API (`apps/api`) · SQL Server via EF Core · xUnit and Vitest.

Plans live in `docs/superpowers/plans/`. Start with `2026-10-19-hr-payroll-vertical-slices.md`.

Daily attendance, monthly payroll and finalisation are implemented through S5; see [the S3 report](docs/reports/s3-attendance.md),
[the S4 report](docs/reports/s4-payroll.md) and [the S5 report](docs/reports/s5-finalise.md). Leave, user management and release hardening remain S6–S8.

## Monthly payroll and PDF runtime

Open **Payroll Summary**, select a month, then use **Print** or **Export PDF**. All three roles may view, print and
export. Draft reports use current rates; finalised reports use the stored snapshot of figures, rates and company details.
The filename is `Payroll_YYYY-MM.pdf`. If the report changes before export, reload it before downloading so the
PDF cannot silently differ from the visible figures.

Administrators can **Finalise month** after confirming the displayed totals. Future UAE months cannot be finalised.
Finalisation freezes the report and locks every attendance write in that month. Later worker or company changes do not
alter the finalised report or PDF. **Reopen month** requires an audit reason and returns the report to a draft using current
rates. HR Staff and Viewer accounts can view and export but cannot finalise or reopen. Reload if another user changes the
report before confirmation.

PDF generation is free: PdfPig 0.1.16 generates the English report directly on the API server, with embedded Noto Sans
fonts. No paid PDF service, browser installation, QuestPDF licence or trial is required. See
[third-party notices](THIRD-PARTY-NOTICES.md). Normal API build/publish includes the embedded fonts and licence files.
The owner confirmed English prototype scope; Arabic/complex-script reporting is outside this build. Unsupported PDF
characters produce a clear error instead of an unexpected server failure.

## Daily attendance

Open **Daily Attendance**, choose a work date, select Present or Absent, and enter hours for Present rows.
Missing records remain **Not recorded** and earn no pay. Use **Save day** to commit the changed rows together.
Select Not recorded to clear an existing record in that same save. Viewer accounts see read-only values.

Basic hours must be positive for Present and within the configured maximum; basic plus overtime cannot exceed 24.
Hours accept at most two decimals. Today's date and future-date validation use UAE time (`Asia/Dubai`).
Pay uses the current worker hourly rate and worker overtime override, or the company overtime rate when no override
is set. Each daily pay component rounds half away from zero to two decimals; saved server amounts are authoritative.
Unsaved date changes and navigation require confirmation. Finalised months display a lock notice and disable editing;
the API also refuses saves, clears and deletions until an Administrator reopens the month.

## Prerequisites

- .NET SDK 10 (see `global.json`)
- Node.js 22.13+ or 24+
- SQL Server LocalDB (included with Visual Studio) for development and tests
- .NET EF Core CLI: `dotnet tool install --global dotnet-ef` (or `dotnet tool update --global dotnet-ef`)

LocalDB is Windows-only. On Linux/macOS, set `ConnectionStrings__Default` for the API and `TEST_SQL_CONNECTION` for tests to point at any SQL Server.

## Run it

Terminal 1 — API on http://localhost:5210 (creates and migrates the `HrPayroll_Dev` LocalDB database on first start):

```bash
dotnet run --project apps/api --launch-profile HrPayroll.Api
```

Terminal 2 — web app on http://localhost:5273 (proxies `/api` to the API):

```bash
cd apps/web
npm install
npm run dev
```

## First run / sign in

Every API endpoint needs a signed-in user except `GET /api/health` and `POST /api/auth/login`. The first administrator is
created automatically on the first start, when the `Users` table is empty. No default password exists.

**Production.** Set `Seed__AdminUsername` and `Seed__AdminPassword` in the environment for the first start. If the
database has no users and these are missing, the API refuses to start. After the first start, remove both variables;
they are ignored once any user exists.

**Development.** Keep the password out of the repository with user secrets:

```bash
dotnet user-secrets set "Seed:AdminUsername" "admin" --project apps/api
dotnet user-secrets set "Seed:AdminPassword" "<a 10+ character password>" --project apps/api
```

Then run the API and the web app (see "Run it") and sign in at http://localhost:5273. Without these secrets the API still
starts in development and logs a warning, but there is nobody to sign in as.

Passwords must be 10 to 128 characters and different from the username. Five wrong passwords lock an account for 15 minutes.

**Token signing key.** `Jwt__Key` must be at least 32 characters; the API refuses to start otherwise. A development-only
key is in `apps/api/appsettings.Development.json` (it is public, never use it elsewhere). Production must set its own random key.

**Roles.** `Administrator` (full access, user management), `HR Staff` (day-to-day HR work) and `Viewer` (read-only).

## Test it

```bash
dotnet test                      # API unit + integration tests (needs LocalDB)
cd apps/web && npm test          # web tests
cd apps/web && npm run lint      # type check
cd apps/web && npm run build     # production build
```

Integration tests create and drop their own throw-away database. To use a different SQL Server, set
`TEST_SQL_CONNECTION` to a connection string (the database name is ignored).

## Configuration

Settings come from `appsettings*.json` and are overridden by environment variables (`__` replaces `:`).
See `.env.example`. Production must set `ConnectionStrings__Default` and `Jwt__Key`; the API refuses to start without them.

.NET does not read `.env` files. `.env.example` only documents the variables; set them in the real environment (IIS/service settings, or `$env:NAME = "value"` in PowerShell).

## Database migrations

```bash
dotnet ef migrations add <Name> --project apps/api --output-dir Data/Migrations
ConnectionStrings__Default="<connection string>" dotnet ef database update --project apps/api
```

```powershell
$env:ConnectionStrings__Default = "<connection string>"; dotnet ef database update --project apps/api
```

The command prints the target server and database before touching it.
