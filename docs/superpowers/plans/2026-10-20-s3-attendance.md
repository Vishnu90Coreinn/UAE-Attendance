# S3 Daily attendance implementation plan

> Execute with superpowers:subagent-driven-development and test-driven-development. The approved design is HANDOVER.md S3 and the master plan, parts D–F.

**Goal:** Save daily attendance explicitly and atomically, with authoritative decimal payroll calculations and a read-only Viewer screen.

**Architecture:** Thin authorized controller, attendance service, SQL constraints, and pure payroll calculator. React uses the existing API client and design system; previews share JSON vectors with xUnit.

**Tech stack:** Existing pinned .NET 10, EF Core SQL Server, React, TypeScript, Vitest; no new dependencies.

## Baseline and branch

- [x] Read handover, master plan, design system and current services/test fixtures.
- [x] Fetch origin; confirm clean `slice/s2b-settings`, commit `01251c8`.
- [x] Confirm baseline: API 419, web 242 passing; no HrPayroll databases remain.
- [x] Create local `slice/s3-attendance`; no pushing or merging.

## Task 1: Calculator and attendance API

Files: `docs/payroll-test-vectors.json`, `apps/api/Services/PayrollCalculator.cs`, attendance entity/configuration/migration, DTOs, service/controller and `apps/api.tests` suites.

- [x] Write shared daily/monthly rounding vectors and failing calculator tests; run `dotnet test --filter PayrollCalculator` and observe red.
- [x] Implement decimal component rounding away from zero; run tests green.
- [x] Write failing endpoint/constraint tests: exact dates, future dates, anonymous/Viewer/HR/Admin, hours and precision, atomic invalid batches, upsert/delete, inactive workers, audit, FK-protected worker deletion and period lock.
- [x] Add attendance schema, serializable service writes, lock interface/stub and explicit controller policies; generate migration and run tests green.
- [x] Prove authorization and period-lock tests detect removed guards.

Response contract: `{date,isFinalised,rows:[{worker,record,dailyPay}]}`. `worker` uses the existing WorkerResponse. `record` is null or `{status,basicHours,overtimeHours}`. `dailyPay` contains `basicPay,overtimePay,totalPay,daysWorked`.

Batch PUT accepts changed rows only. Explicit `status:null` clears a record atomically with other rows; the status property is required so omission cannot erase data. Null status requires zero hours. This represents the approved Not recorded UI state; SQL stores only Present/Absent. DELETE remains available separately.

## Task 2: Attendance screen

Files: `apps/web/src/api/attendance.ts`, `utils/dailyPay.ts`, `features/attendance/*`, `App.tsx`, `components/navItems.ts`, and tests.

- [x] Write failing tests for shared pay vectors and typed API GET/PUT/DELETE calls.
- [x] Implement preview using integer hundredths for money/hours, avoiding binary midpoint rounding drift.
- [x] Write failing screen tests for loading/error/retry/empty, labels and settings, Not recorded defaults, editable HR/Admin, read-only Viewer, disabled hours, live preview, explicit batch save, validation, unsaved date-change confirmation and finalised locks.
- [x] Implement screen and route; verify targeted tests and lint.

## Task 3: Review and verification

- [x] Review spec coverage, then code quality; correct findings and recheck.
- [x] Run full `dotnet build`, `dotnet test`, `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build` (0 warnings/errors).
- [x] Run API/web, inspect desktop and 375px browser, exercise happy/error/Viewer paths and console.
- [x] Stop only servers launched for verification; drop only verification databases and verify no HrPayroll databases remain.
- [x] Commit logical changes in small Conventional Commits, write `docs/reports/s3-attendance.md`, stop at the requested S3 checkpoint.
