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
See `.env.example`. Production must set `ConnectionStrings__Default`; the API refuses to start without it.

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
