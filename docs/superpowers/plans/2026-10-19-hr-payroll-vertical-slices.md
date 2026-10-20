# HR & Payroll System — Feature Scope and Vertical-Slice Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document is the **master plan**. Each slice gets its own step-by-step TDD plan (exact code, commands, expected output) written when that slice starts, so the code in it is never stale.

**Goal:** Rebuild the client's HTML prototype (`Design.html`) as a secure, database-backed web application for DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C, delivered as thin end-to-end slices that can each be demonstrated.

**Architecture:** One ASP.NET Core Web API (controllers → services → EF Core → SQL Server) and one React + TypeScript SPA, mirroring the layout of the existing TimeSheet app (`apps/api`, `apps/web`, `apps/api.tests`). All money and payroll arithmetic lives in one server-side `PayrollCalculator`; the browser never decides a payable amount.

**Tech Stack:** net10.0, ASP.NET Core Web API, EF Core 10 + SQL Server, JWT bearer auth, Serilog, PdfPig, xUnit; React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4, React Router 7, Vitest 5. (Versions as pinned and verified in the S0 plan; EF Core 10 replaces the EF Core 9 first drafted here, to match the .NET 10 SDK.)

**Sources:** `Design.html` (functional reference), quotation QTN-HR-2026-001 v2 (contract scope), the project handover.

---

## Part A — Feature inventory of the prototype

Everything the prototype does, including behaviour that is only implied by its code. Verdicts: **KEEP** build as the prototype behaves · **FIX** build, but correct a flaw · **REPLACE** same purpose, different mechanism · **ADD** not in the prototype but required by the quote or handover · **DROP** do not carry over.

### Shell

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| SH1 | Header with company name, "Official HR & Payroll System", `hr@dxbaluminium.ae` | KEEP | Company name, tagline and email come from `PayrollSettings`, not hardcoded in the UI |
| SH2 | "Logged in as: admin" (static text, no login) | REPLACE | Real login; header shows username and role; logout |
| SH3 | "User Access" shortcut button | KEEP | Visible to Administrator only |
| SH4 | Five tabs: Workers, Attendance, Payroll, Leave, Users | KEEP | React Router routes; tabs hidden when the role cannot use them |
| SH5 | All data in `localStorage` | DROP | SQL Server |
| SH6 | Sample data (4 workers, 2 users) loaded on first run | DROP in production | Development-only seeder |
| SH7 | Horizontally scrolling tables, print-aware CSS | KEEP | Tailwind |

### Worker Directory

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| W1 | Table: ID, Full Name, Designation, Base Rate (AED/hr, 2 dp) | KEEP | |
| W2 | Add worker (modal); ID pre-filled as `EMP-00{count+1}` | FIX | Suggest next code from the highest existing code; unique constraint; server rejects duplicates |
| W3 | Edit worker (same modal) | KEEP | Rate change is audited (old → new) |
| W4 | Delete with confirm | FIX | Delete only if the worker has no history; otherwise deactivate (needs confirmation C7) |
| W5 | Designation is free text (placeholder lists examples) | KEEP | Free text, 1–80 chars. No lookup table |
| W6 | Rate parsed with `parseFloat(...) \|\| 0` (blank becomes 0) | FIX | Rate must be > 0 and ≤ 999.99 |
| W7 | Unescaped values written into HTML | FIX | React escapes output; server validates length and characters |

### Daily Attendance

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| A1 | Date picker, defaults to today | KEEP | Future dates rejected |
| A2 | One row per worker for the date | KEEP | Active workers, plus inactive workers who have a record on that date |
| A3 | Present / Absent dropdown | FIX | Three states: **Not recorded** (default), Present, Absent |
| A4 | Basic hours input, `max="8"` (HTML only, not enforced) | FIX | Server enforces 0 ≤ basic ≤ `MaxBasicHoursPerDay` |
| A5 | Overtime hours input, step 0.5, uncapped | FIX | ≥ 0; upper cap pending C1 (default: basic + overtime ≤ 24) |
| A6 | Live "Total Pay (AED)" per row | KEEP | Preview in the browser using shared test vectors; server value shown after save |
| A7 | Hours inputs disabled when Absent | KEEP | Also disabled when Not recorded |
| A8 | Every change saved immediately and the table re-rendered | REPLACE | Explicit **Save day** with an unsaved-changes indicator; one batch request |
| A9 | Info line: shift 06:00–17:30, 8 basic hours, OT 2.22 AED/hr | KEEP | Values read from `PayrollSettings` |
| A10 | Missing record shown as Present, 8 h, with pay | FIX | Missing record means no attendance and no pay |

### Monthly Payroll

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| P1 | Month picker, defaults to current month | KEEP | |
| P2 | Per worker: Days Worked, Basic Pay, OT Pay, Total | KEEP | Computed on the server |
| P3 | Grand totals row | KEEP | Sum of the rounded rows |
| P4 | Letterhead: company, tagline, email, "Monthly Payroll Report", month | KEEP | |
| P5 | Print button (`window.print`, print-only CSS) | KEEP | |
| P6 | Export PDF (`html2pdf`, rasterised in the browser) | REPLACE | Server-generated PDF (PdfPig; owner requested a free alternative on 2026-10-20), selectable text, identical on every machine |
| P7 | Signature blocks: "Prepared By: HR Department", "Approved By: General Manager" | KEEP | Labels from `PayrollSettings` |
| P8 | File name `Payroll_YYYY-MM.pdf` | KEEP | |
| P9 | Pay uses each worker's current rate, so history changes when a rate changes | FIX | Month can be finalised: figures frozen in a snapshot |
| P10 | Overtime rate hardcoded `2.22` in code | FIX | `PayrollSettings.OvertimeRatePerHour` |
| P11 | Column titled "Total Net Salary" (basic + OT only; no deductions exist) | KEEP | Owner decision 2026-10-20: keep the prototype wording "Total Net Salary" |

### Leave Management

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| L1 | Table: Worker, Type, Start, End, Days, Status | KEEP | |
| L2 | New request modal: worker, type (Annual, Sick, Unpaid, Emergency), start, end | KEEP | Worker stored by ID, not name |
| L3 | Days = `abs(end − start)` + 1; end before start silently accepted | FIX | End ≥ start enforced; days computed on the server |
| L4 | Status badge: Pending / Approved / Rejected | KEEP | |
| L5 | Approve and Reject buttons on every row, any time | KEEP | Role-gated; each decision audited |
| L6 | Delete a request | KEEP | Role-gated (see Part C) |
| L7 | Leave has no effect on attendance or payroll | KEEP | Parity with the prototype until C2/C3 are answered (slice S6b) |

### User Manager

| ID | Prototype behaviour | Verdict | Note |
|----|--------------------|---------|------|
| U1 | Table: Username, Role, Status | KEEP | |
| U2 | Add user: username, password, role (Administrator / HR Staff / Viewer). Password is never stored | FIX | Hashed password, uniqueness, server-side role enforcement |
| U3 | Delete user; `admin` protected by a UI-only flag | FIX | Server rule: cannot delete yourself or the last active Administrator |
| U4 | Status always "Active" | KEEP | Becomes real: Administrator can deactivate |
| U5 | No edit, no password reset | ADD | Change role, activate/deactivate, admin password reset (handover: "manage user access") |

### Required additions (not in the prototype)

| ID | Feature | Why |
|----|---------|-----|
| X1 | Login, logout, session expiry, lockout after repeated failures | Quote: "Secure login"; handover: real authentication |
| X2 | Server-side authorization on every endpoint | Handover |
| X3 | Finalise month / reopen month (Administrator) | Quote: "Finalised months are locked" |
| X4 | Audit log (write-only, no screen) | Handover: `AuditLogs` table |
| X5 | Change my own password | Administrator sets the first password, so users must be able to replace it |
| X6 | Centralised error handling, structured logs, correlation ID | Handover |
| X7 | Database backups (daily, 14-day retention) | Quote section 06 |

---

## Part B — What we deliver

**Deliver — core (contractual).** Everything marked KEEP, FIX or REPLACE in Part A, plus X1–X7.

**Deliver — only if you approve (small additions).**

| ID | Addition | Default if you say nothing |
|----|----------|---------------------------|
| O1 | "Mark all present (8 h)" button on the attendance screen. Fills the form; nothing is saved until Save day. Keeps the prototype's convenience without the silent default | Not built |
| O2 | "Show inactive workers" toggle in the directory | Built (needed if deactivation is chosen) |
| O3 | Administrator settings screen for overtime rate and company details | **Approved 2026-10-20 — built as slice S2b**, together with an optional per-worker overtime rate that overrides the company rate. (Worker hourly rate was already editable per worker in S2.) |

**Not delivering (quote exclusions and YAGNI).**
Leave accrual or entitlement balances · deductions, advances, loans · public-holiday rules · WPS file export · biometric, WhatsApp or any third-party integration · multi-company or multi-tenant · import of existing worker/attendance records · user training · native mobile app · email notifications · password-reset by email · MFA · audit-log screen · report builder or Excel export · attendance calendar or bulk-month entry.

---

## Part C — Decisions and confirmations

### Technical decisions for you to approve

| ID | Decision | Recommendation | Reason |
|----|----------|----------------|--------|
| D1 | PDF generation | Server-side with PdfPig 0.1.16 | Owner requested a free alternative on 2026-10-20; preserves selectable text without a revenue-based PDF licence. Supersedes QuestPDF. English prototype scope confirmed; fonts are embedded. |
| D2 | Authentication | JWT bearer, 8-hour expiry, no refresh tokens, `PasswordHasher` (PBKDF2) | Same pattern as TimeSheet; no refresh-token machinery for a small internal tool |
| D3 | Schema deviations from the handover's suggested list | Drop `Roles` (3 fixed roles → a checked column); drop `EmployeePayRates` (rate snapshot at finalise + audited changes cover the need); name the table `Workers` to match the UI | Fewer tables to build and test. Say so if you want them back |
| D4 | Attendance save model | One batch `PUT` per day, explicit Save | Autosave per keystroke hides failures |
| D5 | Integration tests | Run against real SQL Server (LocalDB or a container), not EF InMemory | InMemory does not enforce unique constraints, decimal precision or check constraints, which are exactly what we must test |
| D6 | Rounding | Round half away from zero to 2 dp **per day**, per component (basic, OT); month = sum of rounded days | The month adds up from what the attendance screen shows |

### Client confirmations (from the quote, section 3)

Each has a default so work is not blocked; the default is what gets built if no answer arrives.

| ID | Question | Default built | Slice affected |
|----|----------|---------------|----------------|
| C1 | Is overtime a flat AED 2.22/hr? Any daily or monthly overtime cap? Note UAE labour law generally requires ≥125% of basic hourly wage | Flat 2.22 from `PayrollSettings`; no cap beyond basic + OT ≤ 24 h | S3, S4 |
| C2 | Pay treatment of each leave type (paid/unpaid; sick-leave pay scale) | Leave is informational only (prototype parity) | S6b |
| C3 | Do approved leave days fill attendance? Calendar days or working days? | No linkage; calendar days, inclusive | S6, S6b |
| C4 | Weekly off day, and is it paid? | Not modelled | none in v1 |
| C5 | Who finalises a month, and can it be reopened? | Administrator finalises and reopens (reopen needs a reason, audited) | S5 |
| C6 | Roles matrix | See below | S1 |
| C7 | Remove a worker: delete or deactivate? | Deactivate; hard delete only if the worker has no attendance, leave or payroll rows | S2 |
| C8 | Hosting: approval from the infrastructure owner, OS/web server (IIS or Nginx), SQL Server edition and licence, backup tooling, data residency | Track T-H below. Nothing assumed | S8 |

**Proposed roles matrix (C6 default).**

| Capability | Administrator | HR Staff | Viewer |
|------------|:-:|:-:|:-:|
| View workers, attendance, payroll, leave | ✔ | ✔ | ✔ |
| Add/edit/deactivate workers, change rates | ✔ | ✔ | — |
| Record attendance | ✔ | ✔ | — |
| Submit leave | ✔ | ✔ | — |
| Approve/reject leave | ✔ | ✔ | — |
| Delete leave | ✔ (any) | ✔ (Pending only) | — |
| Print / export payroll | ✔ | ✔ | ✔ |
| Finalise / reopen month | ✔ | — | — |
| Manage users | ✔ | — | — |

---

## Part D — Architecture, structure and conventions

```
UAE-Attendance/
  apps/
    api/                              ASP.NET Core Web API (net10.0)
      Program.cs
      Controllers/                    thin: bind, authorize, call service, map result
      Dtos/                           request/response records, one file per feature
      Services/                       business rules, one class per feature
        PayrollCalculator.cs          the only place pay is computed
      Data/
        AppDbContext.cs
        Entities/                     one file per entity
        Migrations/
        DevSeeder.cs                  development only
      Middleware/                     CorrelationIdMiddleware, ExceptionHandlingMiddleware
      Pdf/                            PayrollPdfBuilder.cs
      Auth/                           Roles.cs, Policies.cs, JwtTokenService.cs
    api.tests/                        xUnit: unit/ and integration/
    web/
      src/
        api/                          typed fetch client + one module per feature
        components/                   Layout, DataTable, Modal, ConfirmDialog, FormField, StatusBadge
        features/                     auth/, workers/, attendance/, payroll/, leave/, users/
        contexts/AuthContext.tsx
        utils/                        money.ts, dates.ts
        styles.css
  docs/
    superpowers/plans/                this plan and per-slice plans
    payroll-test-vectors.json         shared by xUnit and Vitest
    deployment.md                     written in S8
```

**Conventions.**
- Money: C# `decimal`, SQL `decimal(9,2)`. Hours: SQL `decimal(4,2)`. Never `double`.
- Dates: `DateOnly` / SQL `date` for work dates and leave; `DateTime` UTC for timestamps. Month key is the string `YYYY-MM`.
- Errors: RFC 7807 `ProblemDetails`, validation errors as a field → message map. No stack traces to clients.
- Authorization: every controller carries `[Authorize(Policy = ...)]`; no endpoint is anonymous except `POST /api/auth/login` and the health check.
- Configuration: connection string, JWT key, seed administrator via environment variables. No secrets in the repo.
- Logging: Serilog to console and rolling file; never log passwords, tokens or request bodies.
- Audit: `IAuditLogger.Write(action, entityType, entityId, details)` called by services, not controllers.

### Data model (introduced slice by slice)

| Table | Key columns | Constraints | Slice |
|-------|-------------|-------------|-------|
| `Users` | Id, Username, PasswordHash, Role, IsActive, FailedLoginCount, LockoutEndUtc, CreatedUtc | Unique `Username` (case-insensitive); `Role` check in (Administrator, HR Staff, Viewer) | S1 |
| `AuditLogs` | Id, TimestampUtc, ActorUsername, Action, EntityType, EntityId, DetailsJson | No FK to Users (survives user deletion) | S1 |
| `PayrollSettings` | Id (=1), CompanyName, Tagline, ContactEmail, OvertimeRatePerHour, MaxBasicHoursPerDay, ShiftDescription, PreparedByLabel, ApprovedByLabel | Single-row check | S2 |
| `Workers` | Id, WorkerCode, FullName, Designation, HourlyRate, **OvertimeRate (nullable)**, IsActive, CreatedUtc, UpdatedUtc | Unique `WorkerCode` (case-insensitive); `HourlyRate` > 0; `OvertimeRate` is NULL (= company rate) or ≥ 0 (added in S2b) | S2 / S2b |
| `Attendance` | Id, WorkerId, WorkDate, Status, BasicHours, OvertimeHours, UpdatedUtc, UpdatedBy | Unique (`WorkerId`, `WorkDate`); `Status` in (Present, Absent); hours ≥ 0; absent ⇒ hours 0; index on `WorkDate`; FK restrict | S3 |
| `PayrollPeriods` | Id, Year, Month, OvertimeRateApplied, FinalisedUtc, FinalisedBy | Unique (`Year`, `Month`). A row exists only for finalised months | S5 |
| `PayrollDetails` | Id, PeriodId, WorkerId, WorkerCode, WorkerName, Designation, HourlyRate, **OvertimeRate** (the effective rate used), DaysWorked, BasicHours, OvertimeHours, BasicPay, OvertimePay, TotalPay | FK `PeriodId` cascade; unique (`PeriodId`, `WorkerId`) | S5 |
| `LeaveRequests` | Id, WorkerId, LeaveType, StartDate, EndDate, Days, Status, CreatedBy, CreatedUtc, DecidedBy, DecidedUtc | Check `EndDate >= StartDate`; `LeaveType` in the four types; `Status` in (Pending, Approved, Rejected); FK restrict | S6 |

---

## Part E — Business rules (the executable specification)

These rules are implemented once in `PayrollCalculator` and covered by `docs/payroll-test-vectors.json`.

| # | Rule |
|---|------|
| R1 | Daily basic pay = `BasicHours × WorkerHourlyRate`, rounded to 2 dp (half away from zero) |
| R2 | Daily overtime pay = `OvertimeHours × effective overtime rate`, rounded to 2 dp. Effective rate = the worker's own `OvertimeRate` if set, otherwise the company `OvertimeRatePerHour` from `PayrollSettings` (both user-editable from S2b) |
| R3 | Daily total = R1 + R2. **Absent or Not recorded = 0.00** |
| R4 | Days worked = count of days with Status = Present |
| R5 | Month basic / OT / total = sum of the rounded daily figures; grand totals = sum of the rounded worker rows |
| R6 | Present requires basic hours > 0. Absent forces both hours to 0 |
| R7 | Basic hours ≤ `MaxBasicHoursPerDay` (8). Basic + overtime ≤ 24 |
| R8 | A finalised month rejects any attendance write for a date inside it (HTTP 409) |
| R9 | Draft payroll uses the worker's current hourly rate and current effective overtime rate, so a rate change recalculates every month that is **not finalised**. Finalising copies both rates (per worker) into the snapshot; the finalised view and PDF read only the snapshot |
| R10 | Payroll lists every active worker, plus any inactive worker with attendance in that month |
| R11 | Leave days = `EndDate − StartDate + 1` (calendar days). End before start is rejected. A worker cannot have two overlapping non-rejected requests |

**Worked examples (become test vectors).**

| Case | Inputs | Result |
|------|--------|--------|
| Normal day with overtime | rate 12.50, Present, 8 h basic, 2 h OT | basic 100.00, OT 4.44, total 104.44 |
| Absent | rate 12.50, Absent | 0.00 |
| Not recorded | rate 12.50, no record | 0.00, not counted as a day worked |
| Half-way rounding (basic) | rate 10.50, 7.75 h | 81.375 → **81.38** |
| Half-way rounding (overtime) | OT 0.25 h at 2.22 | 0.555 → **0.56** |
| Month | rate 12.50, 22 Present days at 8 h, 10 OT hours total | basic 2200.00, OT 22.20, total 2222.20, days 22 |
| Rate change after finalise | finalise at 12.50, later set rate 14.00 | finalised report still shows 12.50 |

---

## Part F — Vertical slices

A slice is complete only when a user can do the thing in the browser, backed by the database, with server-side rules and tests. No slice leaves a half-built layer behind.

**Definition of done (every slice).**
- [ ] Failing tests written first, then passing: unit tests for rules, integration tests for endpoints (including role matrix and validation failures)
- [ ] Every new endpoint has an authorization test per role (allowed role → 2xx, forbidden role → 403, anonymous → 401)
- [ ] EF migration included and applies cleanly to an empty database
- [ ] Browser walkthrough of the demo script done, console free of errors
- [ ] No secrets, no stack traces in responses, no sensitive values in logs
- [ ] Small commits; slice ends with a merge-ready branch `slice/sN-name`

### S0 — Walking skeleton (0.5–1 day)

**Detailed step-by-step plan:** `2026-10-19-s0-walking-skeleton.md` (supersedes the task list below; it also records the deviations from this master plan: EF Core 10, ports 5210/5273, HTTP-only dev).

**Demo:** `dotnet run` and `npm run dev` start; the browser shows the app shell, and a status chip reads "API: OK, Database: OK".

**Tasks**
- [ ] Create `HrPayroll.sln`, `apps/api` (net10.0), `apps/api.tests` (xUnit), `apps/web` (Vite + React + TS + Tailwind 4 + Router 7 + Vitest)
- [ ] `AppDbContext`, SQL Server connection from an environment variable, first empty migration
- [ ] `GET /api/health` (checks the database); Serilog; `CorrelationIdMiddleware`; `ExceptionHandlingMiddleware` returning `ProblemDetails`
- [ ] Web: `Layout` with the five nav items (disabled placeholders), typed `api/client.ts`, health chip
- [ ] Tests: health endpoint integration test against real SQL Server; one Vitest render test
- [ ] `.gitignore`, `.editorconfig`, `README.md` with run instructions, `.env.example`

### S1 — Sign in and role guard (1–1.5 days)

**Demo:** log in as the seeded Administrator, see username and role in the header, log out; wrong password five times locks the account briefly; a Viewer token is refused (403) on an Administrator endpoint.

**DB:** `Users`, `AuditLogs`.
**API:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`; policies `AnyUser`, `HrOrAdmin`, `AdminOnly`; `IAuditLogger`.
**UI:** login page, `AuthContext`, protected routes, role-aware navigation, header with "Logged in as {user} ({role})", logout, change-password dialog.

**Tasks**
- [ ] Tests first: password hashing round-trip; lockout after 5 failures for 15 minutes; token carries role claim; 401/403 behaviour
- [ ] `User` entity + configuration + migration; `Roles` and `Policies` constants
- [ ] `AuthService` (login, lockout, change password) and `JwtTokenService`
- [ ] First-run seeder: creates the Administrator from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`; refuses to start in Production if the variables are missing and no user exists; never ships a default password
- [ ] `AuditLogs` + `IAuditLogger`; write login success/failure and password changes
- [ ] Login rate limiting at the HTTP layer
- [ ] Web: `AuthContext` (token kept in memory, mirrored to `sessionStorage`), route guard, 401 interceptor sends to login, nav filtered by role
- [ ] Open question C6 confirmed or the proposed matrix adopted

### S2 — Worker directory (0.5–1 day)

**Demo:** as HR Staff add a worker, edit the rate, deactivate; try a duplicate code and see the error; as Viewer the same screen is read-only.

**DB:** `PayrollSettings` (seeded single row with defaults 2.22 / 8 / "06:00 AM – 05:30 PM"), `Workers`.
**API:** `GET /api/workers?includeInactive`, `GET /api/workers/next-code`, `POST /api/workers`, `PUT /api/workers/{id}`, `POST /api/workers/{id}/deactivate`, `POST /api/workers/{id}/activate`, `DELETE /api/workers/{id}` (only when no history), `GET /api/settings/payroll`.
**UI:** worker table, add/edit modal, confirm dialog, "Show inactive" toggle (O2), empty and error states.

**Tasks**
- [ ] Tests first: duplicate code (case-insensitive) → 409; rate ≤ 0 → 400; delete with history → 409 and suggests deactivate; next-code skips deleted gaps; rate change writes an audit row with old and new values
- [ ] `Worker`, `PayrollSettings` entities, configuration and migration
- [ ] `WorkerService`, `WorkersController` (read: `AnyUser`; write: `HrOrAdmin`)
- [ ] `DevSeeder` loads the four prototype workers (development environment only)
- [ ] Web: `features/workers` list, form with client-side validation mirroring server rules, role-aware buttons
- [ ] `utils/money.ts` formatter (2 dp, "AED")

### S2b — Settings and overtime rates (0.5–0.75 day; added 2026-10-20, built before S3)

**Why:** the owner wants the salary and overtime amounts to be user-defined. A worker's hourly rate is already editable (S2); the overtime rate was fixed at AED 2.22. This slice makes overtime configurable at two levels so `PayrollCalculator` (S3) is built on final rules.

**Demo:** the Administrator opens **Settings**, changes the company overtime rate from 2.22 to 2.50 and saves; on a worker, sets an overtime rate of 3.00 (blank = company rate); the worker list shows the effective overtime rate; HR Staff and Viewer cannot open Settings or change the company rate.

**Rules:** `PUT /api/settings/payroll` (**Administrator only**; reads stay `AnyUser`) updates `companyName`, `tagline`, `contactEmail`, `overtimeRatePerHour` (0–999.99, ≤ 2 dp), `maxBasicHoursPerDay` (> 0, ≤ 24), `shiftDescription`, `preparedByLabel`, `approvedByLabel`; every field validated and trimmed; an audit row `SettingsChanged` holds only changed fields as `{old,new}`; nothing changed → no audit row. `Workers.OvertimeRate` nullable decimal(9,2), NULL or ≥ 0 (0 = no overtime pay); create/update accept an optional `overtimeRate` (blank/null = use the company rate); changes are audited like the hourly rate; worker JSON gains `overtimeRate` (nullable) and `effectiveOvertimeRate`. Migration `AddOvertimeRates`. R2/R9 as above.
**UI:** a **Settings** tab (Administrator only) with labelled fields, a note "Changing the overtime rate recalculates every month that is not finalised", success/error feedback; the worker form gets "Overtime rate (AED/hr) — optional" with the hint "Leave blank to use the company rate (X)"; the worker table gets an "Overtime Rate (AED/hr)" column showing the value or "Company rate (X)".
**Tests:** role matrix for the PUT (HR/Viewer 403), validation matrix, audit rows, worker override round-trip, constraint (negative override rejected), existing worker tests keep passing, web tests for the Settings screen, tab visibility by role and the worker form/table changes.

### S3 — Daily attendance (1–1.5 days)

**Demo:** pick a date, mark workers Present with hours and overtime, see live pay, save; reopen the date and the values persist; an unrecorded worker shows "Not recorded" and 0.00; basic hours of 9 are refused.

**DB:** `Attendance`.
**API:** `GET /api/attendance?date=`, `PUT /api/attendance/{date}` (batch), `DELETE /api/attendance/{date}/{workerId}` (back to Not recorded). Response includes server-computed daily pay per row.
**UI:** date picker, status select (Not recorded / Present / Absent), hours inputs, live pay preview, Save day, unsaved indicator, optional "Mark all present" (O1).

**Tasks**
- [ ] Create `docs/payroll-test-vectors.json` from the Part E examples
- [ ] Tests first: `PayrollCalculator.DailyPay` against every vector; validation rules R6, R7; unique (worker, date) upsert; future date → 400; batch is all-or-nothing
- [ ] `PayrollCalculator` (pure, no database access)
- [ ] `Attendance` entity, configuration, migration
- [ ] `AttendanceService` + controller (read: `AnyUser`; write: `HrOrAdmin`); write path already checks "is this month finalised" through a stub that S5 completes
- [ ] Web: `features/attendance`; `utils/dailyPay.ts` implements the same formula and a Vitest suite runs the same JSON vectors so browser and server cannot drift
- [ ] Confirm C1 (overtime rate and cap) or proceed on defaults

### S4 — Monthly payroll, print and PDF (1–1.5 days)

**Demo:** choose a month, see per-worker days, basic, OT and total with grand totals; click Print (clean letterhead report, signature blocks); click Export PDF and open `Payroll_2026-10.pdf`.

**DB:** none new.
**API:** `GET /api/payroll?month=YYYY-MM` (draft calculation), `GET /api/payroll/pdf?month=YYYY-MM`.
**UI:** month picker, report component shared by screen and print, Print button (print stylesheet from the prototype), Export PDF button, "Draft" badge.

**Tasks**
- [ ] Tests first: month aggregation against the worked month example; R10 worker listing; zero-attendance worker shows 0 days and 0.00; totals equal sum of rows; PDF endpoint returns `application/pdf` with a non-empty body and the right filename
- [ ] `PayrollCalculator.MonthSummary`; `PayrollService.GetDraft(month)`
- [ ] `PayrollPdf` (PdfPig): letterhead, table, totals, Prepared By / Approved By blocks, page numbers, A4 portrait
- [ ] Web: `features/payroll` report component; `@media print` rules hiding everything except the report
- [ ] Manually compare screen, print preview and PDF for the same month; numbers must be identical

### S5 — Finalise and lock a month (0.5–1 day)

**Demo:** Administrator finalises October; the report shows "Finalised" with who and when; change a worker's rate and the October report does not move; try to edit October attendance and get a clear refusal; Administrator reopens with a reason.

**DB:** `PayrollPeriods`, `PayrollDetails`.
**API:** `POST /api/payroll/{month}/finalise`, `DELETE /api/payroll/{month}/finalise` (body: reason). `GET /api/payroll` and the PDF read the snapshot when one exists.
**UI:** Finalise button with a confirm dialog that restates the totals; "Finalised by {user} on {date}" banner; Reopen action with a reason field; attendance screen shows a lock notice for finalised dates.

**Tasks**
- [ ] Tests first: snapshot equals the draft at the moment of finalising; later rate change leaves the snapshot untouched (R9); attendance write inside a finalised month → 409 (R8); finalising twice → 409; future month → 400; reopen requires `AdminOnly` and a reason; reopen and re-finalise produces new figures
- [ ] Entities, migration; the finalise service runs in a single SQL transaction
- [ ] Replace the S3 stub with the real lock check
- [ ] Audit rows for finalise and reopen (reopen stores the previous totals in `DetailsJson`)
- [ ] Web: finalised state in the report, lock notices
- [ ] Confirm C5 or proceed on defaults

### S6 — Leave management (0.75–1 day)

**Demo:** submit a request (end before start is refused), see Days calculated, approve and reject as HR Staff, delete as permitted, Viewer sees the list only.

**DB:** `LeaveRequests`.
**API:** `GET /api/leave?status=&workerId=`, `POST /api/leave`, `POST /api/leave/{id}/approve`, `POST /api/leave/{id}/reject`, `DELETE /api/leave/{id}`.
**UI:** table with status badges, request modal (active workers only), role-aware action buttons, confirm on delete.

**Tasks**
- [ ] Tests first: R11 days calculation (same-day = 1, month boundary, leap day); end < start → 400; overlap → 409; HR Staff cannot delete a non-Pending request but Administrator can; decision writes an audit row; inactive worker → 400
- [ ] Entity, configuration, migration; `LeaveService`; controller
- [ ] Web: `features/leave`
- [ ] Confirm C3 (calendar vs working days)

### S6b — Leave linked to attendance/payroll (conditional, 0.5–1.5 days)

Build **only** if C2/C3 say leave must affect pay or attendance. The quote classes material payroll-rule changes as a change request, so agree scope and price in writing before starting. Likely shape: approved paid-leave days count as days worked and are paid at a stated rule; approved unpaid-leave days are shown as unpaid. This slice changes `PayrollCalculator`, the test vectors and the report columns. If the client needs it in the first release, build it before S5 so the finalised snapshot already includes leave.

### S7 — User management (0.5–0.75 day)

**Demo:** as Administrator create an HR Staff user and a Viewer, log in as each, change a role, deactivate (login now fails), reset a password, try to delete yourself or the last Administrator and be refused.

**API:** `GET /api/users`, `POST /api/users`, `PUT /api/users/{id}` (role, active), `POST /api/users/{id}/reset-password`, `DELETE /api/users/{id}`; all `AdminOnly`.
**UI:** user table, add modal (username, password with strength hint, role), per-row actions; header "User Access" shortcut.

**Tasks**
- [ ] Tests first: duplicate username → 409; password minimum 10 characters; cannot delete or deactivate yourself; cannot remove, demote or deactivate the last active Administrator; deactivated user's existing token is rejected on the next request; password hash never appears in any response
- [ ] `UserService`, controller; token validation checks `IsActive` on each request
- [ ] Web: `features/users`
- [ ] Audit rows for create, role change, deactivate, reset, delete

### S8 — Hardening, deployment and acceptance (1–2 days)

**Demo:** the application running on the client's HTTPS address; a restore of last night's backup into a scratch database; the client's UAT checklist signed off.

**Tasks**
- [ ] Security pass: endpoint-by-role matrix test generated from the route table; HTTPS redirect and HSTS; security headers (CSP, X-Content-Type-Options, frame denial); CORS limited to the app origin; request-size limits; confirm no `dangerouslySetInnerHTML`; dependency vulnerability scan (`dotnet list package --vulnerable`, `npm audit`)
- [ ] Error and log review: induce a failure, confirm the client sees a `ProblemDetails` with a correlation ID and the log has the detail
- [ ] Deployment (after C8): separate site/app and separate SQL database and login on the existing server; environment variables for secrets; migration applied by a documented command; `docs/deployment.md`
- [ ] Backups: daily full backup, 14-day retention, tested restore. If the SQL Server edition has no SQL Agent (Express), use `sqlcmd` plus a scheduled task and document it
- [ ] UAT script covering each module and the finalise/reopen cycle; fix list; two revision rounds per the quote
- [ ] Handover pack: README, admin guide (first-run admin, user creation), runbook (restart, logs, restore)

### Track T-H — Hosting verification (runs in parallel from day 1)

The biggest unknown is not code. Start these immediately; none blocks S0–S7 on a developer machine.
- [ ] Owner of the existing AWS environment agrees in writing to host another company's application (quote section 9)
- [ ] Server specification, free CPU/RAM/disk, OS and web server (IIS or Nginx), SQL Server edition, licence position
- [ ] Separate database, login and file/log folders; confirm network isolation from the TimeSheet database
- [ ] Backup arrangements, retention and restore owner; data-residency requirements
- [ ] First staging deployment as soon as S1 is done, so deployment problems surface early

---

## Part G — Schedule and milestones

| Slice | Engineering days | Cumulative | Notes |
|-------|:---:|:---:|-------|
| S0 Skeleton | 0.5–1 | 0.5–1 | |
| S1 Sign in | 1–1.5 | 1.5–2.5 | |
| S2 Workers | 0.5–1 | 2–3.5 | |
| S3 Attendance | 1–1.5 | 3–5 | |
| S4 Payroll + PDF | 1–1.5 | 4–6.5 | |
| S5 Finalise | 0.5–1 | 4.5–7.5 | |
| S6 Leave | 0.75–1 | 5.25–8.5 | |
| S7 Users | 0.5–0.75 | 5.75–9.25 | **Working demonstration** (all five modules) |
| S8 Hardening + deploy | 1–2 | 6.75–11.25 | Deployment and acceptance |

Roughly 7–11 engineering days. The handover's 6–9 days holds only if the generated code needs little rework, so plan on the upper half. The 10–14 working days quoted to the client still covers it, provided the client supplies the C1–C8 answers within the first few days.

**Payment milestones map to the slices.** 40% on scope confirmation (before S0) · 40% after the working demonstration (end of S7, shown on a staging URL if T-H allows) · 20% after deployment and acceptance (end of S8).

**Order rationale.** Authentication comes first because every later endpoint needs a role. Workers precede attendance, attendance precedes payroll, and payroll precedes finalise because each depends on the previous one's data. Leave and Users are independent of payroll, so they sit late and give the client time to answer C2/C3.

---

## Part H — Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Hosting approval or capacity not confirmed | Cannot deploy | Track T-H starts day 1; deploy a staging skeleton after S1 |
| Overtime rate (AED 2.22) is below the legal minimum premium | Client pays staff incorrectly; reputational risk for the developer | Raise C1 in writing now; value is configuration, not code |
| Client changes payroll rules mid-build | Rework, cost | Quote section 3 makes it a change request; rules are isolated in `PayrollCalculator` and test vectors |
| Browser and server pay calculations drift | Screen shows a different amount from the report | One JSON vector file tested in both xUnit and Vitest; server value is authoritative |
| SQL Server Express has no scheduled backups | Quote promises daily backups | Decide the mechanism in T-H; test a restore in S8 |
| PDF font coverage | English prototype scope | Embedded Noto Sans; unsupported glyphs return a clear error; complex scripts excluded by owner |
| Generated code quality varies | Hidden bugs | TDD per slice, role-matrix tests, review each slice before merge |
| Existing data must be entered by someone | Client expects it done | Quote excludes it; say so explicitly at the demonstration |

---

## Part I — Prompt template for each slice

When starting a slice, give the coding agent exactly this, with the slice section pasted in:

```
Implement slice {SN} of docs/superpowers/plans/2026-10-19-hr-payroll-vertical-slices.md.
Read Part D (structure, conventions) and Part E (rules) first. Follow the slice's task list in order.
Write the failing test before each piece of code and show it failing. Keep each controller thin; put rules in
a service; put money arithmetic only in PayrollCalculator. Do not add features, libraries or tables that the
slice does not list. Finish with the Definition of Done checklist and report anything you could not verify.
```
