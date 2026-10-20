# HR & Payroll System — Handover for ChatGPT / Codex

You are taking over the build of a small, single-company HR & Payroll web application. Slices S0–S2 are done and tested. Your job is to build S3–S8 and the deployment pack, working slice by slice. The owner (VishnuRaj) and Claude will review everything once you are done and then ask for adjustments, so **keep each slice on its own branch, keep commits small, and write a short report per slice** (format at the end).

Read this whole file first. Then read `docs/superpowers/plans/2026-10-19-hr-payroll-vertical-slices.md` (master plan) and `docs/design-system.md`. If anything here conflicts with the repo, trust the repo and tell the owner.

---

## 1. Project in one paragraph

Client: **DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C** (UAE). Developer/owner: **VishnuRaj**. The client supplied an HTML prototype (`Design.html`, localStorage only) with five modules: **Worker Directory, Daily Attendance, Payroll Summary, Leave Management, User Manager**. We are rebuilding it as a real application: React + TypeScript frontend, ASP.NET Core Web API, SQL Server, hosted on the owner's existing AWS infrastructure. It is **one company, not multi-tenant**, deliberately simple, and must stay close to the prototype. Do not add features, libraries or tables that are not in this document or the master plan without asking.

Commercial context (so you understand the scope limits): fixed price quote QTN-HR-2026-001 v2 — AED 1,500 development, hosting and maintenance AED 100/month or AED 1,000/year. Excluded: new modules, biometric/WhatsApp/WPS integration, advanced statutory payroll, importing existing records, training, native apps. Anything outside the five modules is a change request, not part of this build.

## 2. Repository and branches

- Repo: `https://github.com/Vishnu90Coreinn/UAE-Attendance` (local: `D:\GitHubRepository\UAE-Attendance`).
- Branches on origin, **stacked, not yet merged**: `master` (only the first hygiene commit) ← `slice/s0-walking-skeleton` ← `slice/s1-sign-in` ← `slice/s2-workers`.
- Continue the stack: create `slice/s3-attendance` from `slice/s2-workers`, then `slice/s4-...` from S3, and so on. Do not push, merge, force-push or delete branches unless the owner asks. Never rewrite history.
- Commit style: Conventional Commits (`feat(api): ...`, `feat(web): ...`, `test(api): ...`, `docs: ...`, `chore: ...`). Small commits.
- Layout:
```
apps/api/        ASP.NET Core Web API (net10.0): Controllers/ Dtos/ Services/ Auth/ Data/ (Entities, Configurations, Migrations) Middleware/
apps/api.tests/  xUnit: Unit/ Integration/ Helpers/
apps/web/        React 19 + TypeScript + Vite 8 + Tailwind 4 + React Router 7 + Vitest 5
docs/            HANDOVER.md, design-system.md, superpowers/plans/*.md
```

## 3. Tech stack and versions (pinned and verified)

net10.0 · EF Core 10.0.13 (SQL Server) · Serilog.AspNetCore 10.0.0 · Microsoft.AspNetCore.Authentication.JwtBearer 10.0.13 · `System.Security.Cryptography.Pkcs` 10.0.13 (direct pin to clear a transitive vulnerability) · xUnit 2.9.3 + Mvc.Testing 10.0.13 · React 19.3 · TypeScript 5.9 · Vite 8 · Vitest 5 · jsdom **29** (30 needs a newer Node than the dev machine's 24.14) · Tailwind 4.3 · lucide-react 1.x · @testing-library. QuestPDF will be added in S4 (decision D1). Keep `dotnet build` at **0 warnings**.

Dev machine: Windows 11, SQL Server **LocalDB** (`(localdb)\MSSQLLocalDB`), Node 24.14, .NET SDK 10.0.300 (`global.json` pins it).

## 4. How to run, test and verify

```bash
# API (http://localhost:5210). First start creates and migrates database HrPayroll_Dev in LocalDB.
# First-run admin: set Seed__AdminUsername and Seed__AdminPassword (>=10 chars) in the environment for the first start,
# or use `dotnet user-secrets` (Seed:AdminUsername / Seed:AdminPassword) in development.
dotnet run --project apps/api --launch-profile HrPayroll.Api

# Web (http://localhost:5273, proxies /api to the API)
cd apps/web && npm install && npm run dev

# Tests
dotnet build                         # must be 0 warnings, 0 errors
dotnet test                          # 296 tests at the end of S2; they need LocalDB
cd apps/web && npm test              # 172 tests at the end of S2
cd apps/web && npm run lint          # tsc --noEmit
cd apps/web && npm run build

# Migrations
dotnet ef migrations add <Name> --project apps/api --output-dir Data/Migrations
```
Integration tests create and drop their own database (`HrPayroll_Test_<guid>`); afterwards LocalDB should contain no `HrPayroll%` databases (check this). Use `TEST_SQL_CONNECTION` to point tests at another server. Dev servers must be stopped and `HrPayroll_Dev` dropped when you finish a verification run so the next run starts clean.

## 5. What is built (end of S2)

**Database** (EF migrations `Initial`, `AddUsersAndAuditLogs`, `AddWorkersAndPayrollSettings`):

| Table | Columns / rules |
|-------|-----------------|
| `Users` | `Id` int identity · `Username` nvarchar(50) unique, case-insensitive (`SQL_Latin1_General_CP1_CI_AS`) · `PasswordHash` nvarchar(256) (PBKDF2 via `PasswordHasher<User>`) · `Role` nvarchar(20) CHECK in (`Administrator`,`HR Staff`,`Viewer`) · `IsActive` · `FailedLoginCount` · `LockoutEndUtc` · `CreatedUtc` |
| `AuditLogs` | `Id` bigint · `TimestampUtc` · `ActorUsername` · `Action` · `EntityType` · `EntityId` · `DetailsJson`. No FK to Users (rows must survive user deletion). Index on `TimestampUtc` |
| `Workers` | `Id` · `WorkerCode` nvarchar(20) unique case-insensitive · `FullName`(120) · `Designation`(80) · `HourlyRate` decimal(9,2) CHECK > 0 · `IsActive` · `CreatedUtc` · `UpdatedUtc` |
| `PayrollSettings` | single row, `Id`=1 (CHECK). `CompanyName`, `Tagline`, `ContactEmail`, `OvertimeRatePerHour` decimal(9,2) = **2.22**, `MaxBasicHoursPerDay` decimal(4,2) = **8**, `ShiftDescription` = "06:00 AM - 05:30 PM", `PreparedByLabel` = "HR Department", `ApprovedByLabel` = "General Manager". Seeded by the migration; read-only through the API until slice **S2b** makes it editable by the Administrator |

**API** (all JSON, camelCase; errors are RFC 9457 problem documents, validation errors carry a camelCase `errors` map):

| Route | Access | Notes |
|-------|--------|-------|
| `GET /api/health` | anonymous | `{status, database}`; 503 + `degraded/unreachable` when the DB is down |
| `POST /api/auth/login` | anonymous, rate limited (10/min/IP) | 200 `{token, expiresUtc, user{id,username,role}}`; 401 generic message; 423 locked (5 failures → 15 min); 429 |
| `GET /api/auth/me` | any user | reads the DB; deleted/inactive user → 401 |
| `POST /api/auth/change-password` | any user | 204; 400 with `errors.currentPassword`/`errors.newPassword` |
| `GET /api/settings/payroll` | any user | the `PayrollSettings` row |
| `GET /api/workers?includeInactive=` | any user | ordered by code |
| `GET /api/workers/next-code`, `GET /api/workers/{id}` | any user | `EMP-NNN` suggestion |
| `POST/PUT /api/workers`, `POST /api/workers/{id}/deactivate|activate`, `DELETE /api/workers/{id}` | HR Staff, Administrator | delete maps FK violation (SQL 547) → 409 "has records… Deactivate instead" |

**Web:** login page, auth context (token in memory + `sessionStorage`, validated with `/me` on load, 401 → sign-out), protected routes, role-aware header (`Logged in as <user> (<role>)`, Change password, Sign out), role-filtered tabs, Change Password dialog, Worker Directory screen (list, add/edit dialog, deactivate/activate/delete with confirmation, "show inactive", empty/loading/error states). `/` redirects to `/workers`. Other tabs are disabled placeholders (`components/navItems.ts` — give an item a `path` to make it a real tab).

## 6. Conventions you must follow (they are enforced by existing tests)

**Security and API**
1. **Secure by default:** the authorization `FallbackPolicy` requires a signed-in user. Only login and health are `[AllowAnonymous]`. Every new controller action must carry an explicit `[Authorize(Policy = Policies.AnyUser | HrOrAdmin | AdminOnly)]`. Unknown routes must stay 404 (a custom authorization result handler handles that).
2. **Role matrix** (master plan C6, proposed default): Viewer = read-only everywhere (view workers, attendance, payroll, leave; print/export payroll); HR Staff = everything operational (workers, attendance, leave submit/approve/reject, delete a *Pending* leave) but **not** finalise/reopen payroll, **not** user management and **not** the company payroll settings (overtime rate, company details — Administrator only); Administrator = everything. Every slice must add a role-matrix test for each route (anonymous 401, forbidden role 403, allowed role success).
3. Controllers stay thin; rules live in services (`Services/XService.cs`); DTOs in `Dtos/`; **money and payroll arithmetic only in one `PayrollCalculator`** (S3) — never in controllers, never decided by the browser. Money is `decimal` (SQL `decimal(9,2)`), hours `decimal(4,2)`. Never `double`.
4. **Audit:** `IAuditLogger.Write(action, actor?, entityType?, entityId?, details?)` only *adds* a row to the `DbContext`; the calling service calls `SaveChangesAsync` so the audit row commits with the change (use a transaction when the entity id is only known after insert, as `WorkerService.Create` does). Audit details must never contain passwords, tokens or hashes.
5. Validation: DataAnnotations plus service rules; field errors come back as `ValidationProblemDetails` with **camelCase keys** (a global `InvalidModelStateResponseFactory` guarantees this). Unique-index races are caught (SQL 2601/2627) and returned as the same field error.
6. Errors: never leak exception text; unexpected errors become a generic 500 problem with a `correlationId`. Every request has an `X-Correlation-ID` (sanitised `^[A-Za-z0-9_-]{1,64}\z`). Logs go through Serilog; never log passwords/tokens/request bodies.
7. Dates: `DateOnly`/SQL `date` for work dates and leave dates; UTC `DateTime` for timestamps; month key string `YYYY-MM`.
8. Configuration comes from `appsettings*.json` overridden by environment variables (`Section__Key`). No secrets in the repo. `Jwt__Key` (>=32 chars) is required (a dev-only key is in `appsettings.Development.json`); `ConnectionStrings__Default` is required; the API refuses to start without them.

**Tests (TDD is mandatory)**
9. Write the failing test first, see it fail for the right reason, then implement. Real SQL Server via the existing fixtures — **not** EF InMemory (it ignores constraints). Reuse helpers in `apps/api.tests/Helpers/`: `ApiFixture` (shared host), `ApiFactory`, `TestDatabase`, `TestUsers` (insert users with hashed passwords), `TestTokens`/login helper, `TestWorkers`. Look at `Integration/WorkersAuthorizationTests.cs` and `WorkersWriteEndpointTests.cs` for the house style.
10. Prove important guards bite (e.g. temporarily break the code and confirm the test fails) when you add security-relevant tests.
11. Web: Vitest + Testing Library; mock the `api/*` modules; test behaviour (roles, validation, states), not implementation details.

**UI (ui-ux-pro-max rules, see `docs/design-system.md`; mandatory)**
12. Keep the prototype's look and wording (slate/blue palette; labels such as "Worker Directory"), but: no emoji as icons (use Lucide icons **with** visible text or `aria-label`), visible labels on all inputs, visible `focus-visible` outlines, touch targets ≥ 44px (`min-h-11`), contrast ≥ 4.5:1, status never by colour alone, loading/empty/error states, specific error messages in `role="alert"`, success feedback in `role="status"`, dialogs trap focus and close on Esc (reuse `components/Dialog.tsx`, `ConfirmDialog.tsx`, `TextField.tsx`), wide tables scroll inside their own container and **never** make the page scroll sideways at 375px. Table text 14px, form text 16px.
13. Reuse `api/client.ts` (`apiGet/apiPost/apiPut/apiDelete`: adds the bearer token, parses problem details and `fieldErrors`, signs out on 401).

**Windows pitfalls we hit**
14. JSON settings files need `\\` for a backslash (`(localdb)\\MSSQLLocalDB`). Shell heredocs mangled quotes and backslashes in our tooling — create files with a proper file-writing tool.
15. Git prints LF→CRLF warnings; harmless (`* text=auto`).

## 7. Decisions already made (do not reopen without the owner)

D1 server-side PDF with **QuestPDF** (check Community licence eligibility) · D2 JWT bearer, 8 h, no refresh tokens, PBKDF2 · D3 schema: no `Roles` table (checked column), no `EmployeePayRates` table (rate snapshot at finalise + audited rate changes), table is `Workers` · D4 attendance saved as one **batch per day** with an explicit Save button · D5 integration tests on real SQL Server · D6 rounding: **half away from zero to 2 dp per day, per component; month = sum of rounded days; grand totals = sum of rounded worker rows** · D7 (2026-10-20, owner) salary and overtime amounts are **user-defined**: worker hourly rate (already editable), company overtime rate (Administrator, Settings screen) and an optional per-worker overtime rate that overrides it (slice S2b) · D8 (owner) the payroll column stays **"Total Net Salary"** as in the prototype.

## 8. Remaining work — build in this order

Build **S2b first, then S3–S8** (S3's `PayrollCalculator` depends on the final overtime rules). Estimated 7.25–11.75 engineering days in total. Each slice must be demonstrable end to end (database → API → UI → tests).

### S2b — Settings and overtime rates (branch `slice/s2b-settings`, from `slice/s2-workers`)

**Why:** salary and overtime amounts must be user-defined. A worker's hourly rate is already editable (S2). The overtime rate was fixed at AED 2.22; this slice makes it configurable at two levels.

- **API:** `PUT /api/settings/payroll` (**Administrator only**; `GET` stays any user) updates `companyName`, `tagline`, `contactEmail`, `overtimeRatePerHour` (0–999.99, ≤ 2 decimals), `maxBasicHoursPerDay` (> 0 and ≤ 24), `shiftDescription`, `preparedByLabel`, `approvedByLabel`; trim and validate every field (camelCase field errors); audit `SettingsChanged` with only the changed fields as `{old,new}` (no row if nothing changed).
- **Workers:** new nullable column `Workers.OvertimeRate` decimal(9,2), CHECK `NULL OR >= 0` (0 means no overtime pay); `POST/PUT /api/workers` accept optional `overtimeRate` (null/blank = use the company rate); changes are audited like the hourly rate (old/new); worker JSON gains `overtimeRate` (nullable) and `effectiveOvertimeRate`. Migration `AddOvertimeRates`.
- **Rule:** effective overtime rate = worker `OvertimeRate` if set, else `PayrollSettings.OvertimeRatePerHour`. Changing either recalculates **every month that is not finalised** (finalised months are frozen by S5).
- **UI:** a **Settings** tab (Administrator only; add it to `navItems.ts` with `roles: ["Administrator"]` and a `path`) with labelled fields and the note "Changing the overtime rate recalculates every month that is not finalised"; the worker form gets "Overtime rate (AED/hr) — optional" with the hint "Leave blank to use the company rate (X)"; the worker table gets an "Overtime Rate (AED/hr)" column showing the number or "Company rate (X)". Follow the design system.
- **Tests:** role matrix for the PUT (HR Staff and Viewer 403, anonymous 401); validation matrix; audit rows; override round-trip; negative override rejected by the API and by the DB constraint; all existing worker/settings tests still pass; web tests for the Settings screen, tab visibility per role, and the worker form/table changes.

### S3 — Daily attendance (branch `slice/s3-attendance`)

**Prototype behaviour to keep:** date picker (default today); one row per worker; Status dropdown; Basic Hours input; Overtime Hours input; live "Total Pay (AED)"; header note "Standard Shift: 06:00 AM - 05:30 PM (8 Basic Hours Max) • Overtime Rate: 2.22 AED/hr" (values from `PayrollSettings`). **Fixes:** a missing record is **Not recorded** (no pay), *not* Present/8h; hours limits enforced on the server; explicit **Save day**; future dates refused.

**Table `Attendance`:** `Id`, `WorkerId` FK (ON DELETE RESTRICT), `WorkDate` date, `Status` nvarchar(10) CHECK in (`Present`,`Absent`), `BasicHours` decimal(4,2), `OvertimeHours` decimal(4,2), `UpdatedUtc`, `UpdatedBy`. UNIQUE (`WorkerId`,`WorkDate`); CHECK hours ≥ 0; CHECK Absent ⇒ both hours 0; index on `WorkDate`. Also add the **test promised in S2**: deleting a worker that has attendance returns 409 with the "Deactivate instead" message.

**Rules (implemented once in `Services/PayrollCalculator.cs`, pure, no DB):**
- R1 daily basic pay = `BasicHours × WorkerHourlyRate`, rounded to 2 dp (half away from zero) · R2 daily OT pay = `OvertimeHours × effective overtime rate` (worker override, else company rate — see S2b), rounded · R3 daily total = R1 + R2; **Absent or Not recorded = 0.00**.
- R6 Present requires basic hours > 0; Absent forces both hours to 0. R7 `BasicHours ≤ MaxBasicHoursPerDay` and `BasicHours + OvertimeHours ≤ 24`.
- Future dates → 400. A date inside a **finalised month** → 409 (S5 supplies the check; add a stub/interface now).
- Inactive workers appear for a date only if they already have a record on that date.

**API:** `GET /api/attendance?date=YYYY-MM-DD` (any user) → every active worker (plus inactive with a record) with their record or null and the server-computed `dailyPay`; `PUT /api/attendance/{date}` (HR/Admin) body = list of `{workerId, status, basicHours, overtimeHours}`, all-or-nothing, upsert, returns the computed rows; `DELETE /api/attendance/{date}/{workerId}` (HR/Admin) → back to Not recorded. Audit `AttendanceSaved` (date, number of rows, workers changed).

**UI:** statuses Not recorded / Present / Absent; hour inputs enabled only for Present; live pay preview uses a TypeScript function that implements the same formula, tested against the **shared vector file** `docs/payroll-test-vectors.json` that the xUnit tests also read (so browser and server cannot drift); server value is authoritative after save; unsaved-changes indicator; optional "Mark all present (8 h)" button is **not approved** — do not build it. Viewer sees read-only values.

**Vectors (put in `docs/payroll-test-vectors.json`):** rate 12.50 Present 8h basic 2h OT → basic 100.00, OT 4.44, total 104.44 · Absent → 0.00 · Not recorded → 0.00 and not a worked day · rate 10.50 × 7.75h → 81.375 → **81.38** · OT 0.25h × 2.22 → 0.555 → **0.56** · month: 22 present days × 8h at 12.50 with 10 OT hours → basic 2200.00, OT 22.20, total 2222.20, days 22 · override: worker overtime rate 3.00 × 2h → 6.00 · no override → company rate · override 0.00 → 0.00 overtime pay.

### S4 — Monthly payroll, print and PDF (`slice/s4-payroll`)

**Prototype to keep:** month picker (default current month); table per worker: Worker Name, Designation, Days Worked, Basic Pay, OT Pay, Total Net Salary; **TOTAL PAYROLL** footer; letterhead (company name, tagline, `Email: … • United Arab Emirates`, "Monthly Payroll Report", `Month: YYYY-MM`); signature blocks "Prepared By: HR Department / Signature & Date" and "Approved By: General Manager / Signature & Stamp" (labels from `PayrollSettings`); Print button; Export PDF `Payroll_YYYY-MM.pdf`. The last column keeps the prototype's wording **"Total Net Salary"** (owner decision D8), even though there are no deductions.

**Rules:** R4 days worked = count of Present days · R5 month figures = sum of the rounded daily figures; grand totals = sum of the rounded worker rows · R9 draft uses the worker's *current* rate and the current OT rate · R10 list every active worker plus any inactive worker with attendance in that month (0 days / 0.00 if none).

**API:** `GET /api/payroll?month=YYYY-MM` (any user) → `{ period, status: "Draft"|"Finalised", company/letterhead fields, lines[], totals }`; `GET /api/payroll/pdf?month=YYYY-MM` (any user) → `application/pdf`, A4 portrait, selectable text (QuestPDF), file name `Payroll_YYYY-MM.pdf`. **UI:** shared report component for screen and print; `@media print` hides everything but the report; Print and Export buttons; "Draft" badge; the numbers on screen, print preview and PDF must be identical.

### S5 — Finalise and lock a month (`slice/s5-finalise`)

**Tables:** `PayrollPeriods` (`Id`, `Year`, `Month`, `OvertimeRateApplied`, `FinalisedUtc`, `FinalisedBy`; UNIQUE (`Year`,`Month`); rows exist only for finalised months) and `PayrollDetails` (`Id`, `PeriodId` FK cascade, `WorkerId` FK RESTRICT, `WorkerCode`, `WorkerName`, `Designation`, `HourlyRate`, `OvertimeRate` (the effective rate used), `DaysWorked`, `BasicHours`, `OvertimeHours`, `BasicPay`, `OvertimePay`, `TotalPay`; UNIQUE (`PeriodId`,`WorkerId`)).
**Rules:** R8 attendance writes inside a finalised month → 409 · R9 finalising copies each worker's hourly rate and effective overtime rate into the snapshot (single SQL transaction); finalised views and the PDF read **only** the snapshot; a later rate change must not move a finalised report · cannot finalise a future month; finalising twice → 409 · **reopen** = delete the period and its details (audited with the reason and the previous totals in `DetailsJson`); **Administrator only** (default for confirmation C5). Endpoints: `POST /api/payroll/{month}/finalise` and `DELETE /api/payroll/{month}/finalise` (body: reason) — Administrator. UI: Finalise button with a confirm dialog that restates the totals; "Finalised by X on DATE" banner; Reopen with a required reason; lock notice on the attendance screen. HR Staff and Viewer must get 403.

### S6 — Leave management (`slice/s6-leave`)

**Prototype to keep:** table: Worker, Leave Type, Start Date, End Date, Days, Status (Pending/Approved/Rejected badges), Actions; **New Leave Request** modal with worker, type (**Annual Leave, Sick Leave, Unpaid Leave, Emergency Leave**), start, end; approve (✅), reject (❌), delete (🗑️) become Lucide icons + text.
**Table `LeaveRequests`:** `Id`, `WorkerId` FK RESTRICT (store the ID, **not** the name), `LeaveType` CHECK in the four types, `StartDate`, `EndDate` (date, CHECK End ≥ Start), `Days` int, `Status` CHECK in (Pending, Approved, Rejected), `CreatedBy`, `CreatedUtc`, `DecidedBy`, `DecidedUtc`.
**Rules:** R11 days = `EndDate − StartDate + 1` (calendar days, computed on the server); end before start → 400 (fixes the prototype's `Math.abs` bug); a worker cannot have two overlapping non-rejected requests (409); only active workers; approve/reject allowed from any state by HR/Admin (as in the prototype) and audited; delete: Administrator any, HR Staff only *Pending*; Viewer read-only. Leave does **not** affect attendance or payroll in this slice (prototype parity). **S6b (conditional, change request):** only if the client confirms leave must change pay/attendance (C2/C3) — do not build it without the owner's go-ahead.

### S7 — User management (`slice/s7-users`)

**Prototype to keep:** table Username, Role, Status, Delete; Add User modal (username, password, role).
**API (Administrator only):** `GET /api/users`, `POST /api/users`, `PUT /api/users/{id}` (role, active), `POST /api/users/{id}/reset-password`, `DELETE /api/users/{id}`. Rules: unique username (case-insensitive) → field error; password policy as `PasswordPolicy` (10–128 chars, not equal to the username); **cannot delete/deactivate yourself; cannot remove, demote or deactivate the last active Administrator**; the password hash never appears in any response; every change audited (`UserCreated`, `UserRoleChanged`, `UserDeactivated`, `UserActivated`, `PasswordReset`, `UserDeleted`).
**Security change required here:** JWT validation must check `IsActive` (and the current role) from the database on every request, so a deactivated or demoted user's existing token stops working immediately. Add the tests. **UI:** the User Manager tab (`navItems.ts`, Administrator only) plus the header "User Access" shortcut button from the prototype (Administrator only); reuse the dialog components; show a password-strength hint.

### S8 — Hardening, deployment, acceptance (`slice/s8-release`)

Security pass: a generated endpoint-by-role matrix test from the route table; HTTPS redirect + HSTS; security headers (CSP, `X-Content-Type-Options`, frame denial); CORS limited to the app origin (none needed if same origin); request-size limits; **ForwardedHeaders** so the login rate limiter sees the real client IP behind a proxy; no `dangerouslySetInnerHTML`; `dotnet list package --vulnerable --include-transitive` and `npm audit` clean. Error/log review (a forced failure returns a problem with a correlation id and the log has the detail). Deployment docs `docs/deployment.md` for the target (see T-H), migrations applied by a documented command (`dotnet ef migrations script --idempotent` is acceptable where the SDK is not installed), backups (**daily, 14-day retention, tested restore**; SQL Express has no SQL Agent → `sqlcmd` + scheduled task), UAT script covering every module and finalise/reopen, README/admin guide/runbook.

### Track T-H — Hosting verification (the owner does the asking; you prepare the checklist)

Do not assume Windows/IIS or Linux/Nginx. The owner must confirm in writing: permission to host another client's app on the existing AWS environment; server specs/free resources; OS and web server; SQL Server edition, capacity and licence; separate database, login and folders; network isolation from the TimeSheet database; backup/restore arrangements; data residency. Produce `docs/deployment.md` for both a Windows/IIS and a Linux/Nginx variant until this is known.

## 9. Open client confirmations (defaults are what you build unless told otherwise)

| ID | Question | Default |
|----|----------|---------|
| C1 | What overtime amount does the client use, and is there a cap? Now **configurable** (company rate and per-worker override, S2b); the shipped default is AED 2.22. UAE labour law generally requires ≥125% of the basic hourly wage for overtime — the owner must verify the amounts before go-live | Company rate 2.22 from `PayrollSettings`; limit only basic+OT ≤ 24 h |
| C2 | Pay treatment of each leave type | Leave informational only |
| C3 | Does approved leave fill attendance? Calendar vs working days? | No link; calendar days |
| C4 | Weekly off day, paid? | Not modelled |
| C5 | Who finalises/reopens a month? | Administrator; reopen needs a reason |
| C6 | Roles matrix | As in section 6 |
| C7 | Delete vs deactivate worker | Deactivate; delete only without records |
| C8 | Hosting approval and details | See T-H |

## 10. Known gaps and technical debt (small, listed so the review is honest)

- `UseSerilogRequestLogging` / `LogContext`: the middleware's log-property behaviour is only checked by manual run; consider a test with an in-memory Serilog sink.
- `ExceptionHandlingMiddleware` has no test for the `Response.HasStarted` rethrow branch or for a non-client `OperationCanceledException`.
- Lockout counter is a plain read-modify-write (a burst of parallel logins could slip past 5 failures); the rate limiter mitigates it.
- Login rate limiting is per `RemoteIpAddress`; behind a reverse proxy everyone shares one bucket until ForwardedHeaders is configured (S8).
- A JSON body with `hourlyRate` as a string returns the key `$.hourlyRate` instead of `hourlyRate` (frontend always sends numbers).
- `AdminSeeder` skips seeding with a warning when the database is unreachable at start-up in Production (the API then starts degraded). Decide in S8 whether to fail hard.
- `WorkerService.NextCode` can exceed 20 characters only for absurd suffixes; not guarded.
- `dotnet-ef` design-time factory prints the target server/database before any migration command — keep that safety.
- Web: cancelling a dialog mid-request does not abort the request (a late success is silent).
- The company name is a literal in `branding.ts`/`Layout`; from S4 read it from `GET /api/settings/payroll` where the user is signed in.
- QuestPDF licence terms need a check before S4 ships.

## 11. Working agreement and report format

For each slice: (1) read the relevant section above and the master plan; (2) create the branch; (3) work test-first in small commits; (4) run the full verification (`dotnet build` 0 warnings, `dotnet test`, `npm test`, `npm run lint`, `npm run build`); (5) run the app and **look at it in a browser** (desktop and 375px wide; console clean; try the happy path, an error path and a Viewer account); (6) leave LocalDB clean; (7) write the report below into the commit message of a final `docs:` commit or hand it to the owner. **Stop after each slice if anything in this document is unclear, if a rule seems wrong, or if you want to deviate** — ask; do not guess.

```
Slice report — S?
Branch / commits:         <branch>, <n> commits, last <sha>
Tests:                    API <n> passed / web <n> passed; build warnings: 0
Built:                    <bullets>
Deviations from the plan: <bullets, with reasons>   (or "none")
Decisions I made:         <bullets>                 (or "none")
Not done / known gaps:    <bullets>
Browser check:            <what you clicked, desktop + 375px, console errors>
Open questions:           <bullets>
```

## 12. First message to send yourself (checklist)

1. Read this file, the master plan and `docs/design-system.md`. 2. `git fetch --all`, check out `slice/s2-workers`, run `dotnet test` and `npm test` and confirm they pass (296 and 172). 3. Create `slice/s2b-settings` and build S2b; report back. Then create `slice/s3-attendance` from it and start S3 with `docs/payroll-test-vectors.json` and the `PayrollCalculator` unit tests. 4. Report back at the end of S3 before starting S4.
