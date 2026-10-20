# S5 Finalise and lock a month

Date: 2026-10-20. Branch: `slice/s5-finalise`, based on S4 `e560076`.

Implementation commits: `bc22586` (snapshot API, SQL locks, migration and tests) and `e25c751` (web controls), followed by the documentation commit containing this report. S5 remains local; no push or merge. S4 was pushed at the owner's earlier request.

## Built

- Administrator-only finalise/reopen endpoints and dialogs. Finalise confirms the displayed month/basic/OT/Total Net Salary and requires its revision. A changed report returns 409 and must be reloaded before confirmation.
- PayrollPeriods and PayrollDetails snapshots, unique month/worker constraints, cascading period deletion and restrictive worker FK. Aggregate amounts/hours use decimal(18,2), avoiding the smaller daily-field limits.
- Frozen worker identity, hourly/effective overtime rates, days/hours/pay and company letterhead. Finalised JSON, screen, print markup and PDF use the stored snapshot. Worker edits, rate changes, new/deactivated workers and Settings changes do not alter it.
- UTC finalisation actor/time in the response; the report shows UAE time and the PDF explicitly labels UTC. Stable revisions include finalisation metadata; decimal scale is normalized across immediate and persisted snapshot reads.
- Atomic finalise/reopen audit records. Reopen requires a trimmed reason of 1–500 characters and retains previous totals, actor/time, company details and revision in the audit. Removing the snapshot restores a current-rate draft.
- Transaction-owned SQL application locks coordinate shared report/attendance access with exclusive finalise/reopen. The month resource protects even empty months. Bounded conflicts return controlled 409 responses.
- The S3 lock stub is replaced with a real check. Batch saves, clears and DELETE inside a finalised month are refused. The existing attendance lock notice/read-only UI is reused.
- Pending dialogs disable dismissal and conflicting actions. HR Staff/Viewer retain view, print and export access without finalise/reopen controls. Future UAE months cannot be finalised; current and empty months are supported.

## Verification

- `dotnet build --no-restore`: **0 warnings, 0 errors**.
- `dotnet test --no-build -- xUnit.MaxParallelThreads=2`: **529 passed**, none failed or skipped.
- `npm test -- --maxWorkers=2`: **317 passed** in 24 files. `npm run lint` and `npm run build` pass.
- Migration generated with EF and applied from an empty real SQL database by the integration fixtures, and during the disposable browser setup.
- Tests cover exact route role matrices, draft/snapshot equality, both overtime rate sources, later mutations, zero-attendance hash stability, UTC timestamps, future/month/reason/revision validation, empty/current months, large monthly values and FK/unique constraints.
- Real SQL coordination tests cover attendance versus finalisation in both directions, empty-month exclusion and simultaneous finalisation (one success, one conflict). Audit failure injection proves rollback for both finalise and reopen.
- Independent combined specification review and then quality review approved. The sole spec test gap was closed with direct draft/snapshot equality and a worker-specific OT override assertion; the subsequent full suite passed.
- Browser at desktop and 375px: stale confirmation/reload, successful Administrator finalise, frozen report after live changes, locked attendance, Viewer finalised export without reopen controls, required reopening reason and return to an editable draft. No page overflow at 375px; console warning/error log was empty.
- Disposable October fixture: basic **281.38**, OT **5.32**, total **286.70** on screen and finalised PDF. Changing a worker's name/hourly/OT rates and company name/OT rate leaves the frozen report unchanged. Reopening recalculates basic **305.38**, OT **8.88**, total **314.26** and shows the updated worker/company. Audit records the reason and previous **286.70** total.
- Direct authenticated attendance PUT and DELETE returned **409** while finalised. After reopening, the browser shows editable status selectors and no lock notice.
- Finalised A4 PDF rendered and visually inspected; selectable text, actor/UTC, frozen company/total and glyph bounds verified. S4 multipage wrapping/layout evidence was reused because those layout rules did not change. Native browser print preview remains the previously documented manual check; it was not repeated.
- Verification servers stopped, the disposable `HrPayroll_S5Verify` database removed, and the final LocalDB query found **zero `HrPayroll%` databases**. Source/doc whitespace checks pass. The only edits after full verification were documentation and trailing blank-line cleanup in two test files.

## Decisions and efficiency

The stored period includes five company fields in addition to the master plan's initial table sketch, making snapshot-only finalised letterheads possible. The POST revision binds confirmation to the totals the Administrator actually reviewed. Neither change adds a module, dependency or external service.

The owner requested avoiding unnecessary repeated work. The clean verified S4 commit was reused without baseline test reruns, dependency installation, licence research or another checkout. Implementation used focused tests; after review, one full API suite and one full web suite ran sequentially. S4 print/multipage checks were reused where unchanged. This workflow is now explicit in HANDOVER.md.

No S5 functional requirements remain outstanding. Next is S6 leave management; leave must not affect attendance or payroll unless the separate S6b change request is approved.
