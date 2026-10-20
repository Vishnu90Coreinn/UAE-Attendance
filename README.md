# HR & Payroll System

Web application for DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C: worker directory, daily attendance, monthly payroll,
leave management and user access.

React + TypeScript (`apps/web`) · ASP.NET Core Web API (`apps/api`) · SQL Server via EF Core · xUnit and Vitest.

Plans live in `docs/superpowers/plans/`. Start with `2026-10-19-hr-payroll-vertical-slices.md`.

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
