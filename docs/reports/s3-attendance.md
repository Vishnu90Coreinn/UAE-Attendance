# Slice report — S3 Daily attendance

Date: 2026-10-20. Codex takeover from the completed S2b handover.

**Branch / commits:** `slice/s3-attendance`, based on `01251c8` (`slice/s2b-settings`). Three implementation commits below, followed by the documentation commit containing this report. No push, merge, history rewrite or branch deletion.

- `3fbfd15` — decimal daily calculator, shared vectors and calculator tests.
- `7e17d1f` — atomic attendance API, SQL migration/constraints, validation, audit and integration tests.
- `1d4f8d9` — attendance screen, pay preview, role-aware access and guarded saves/navigation.

**Tests:** API **477 passed**, web **283 passed**, none skipped or failed. API build: **0 warnings, 0 errors**. Web type-check and production build pass. Baseline was 419 API / 242 web tests.

**Built:**

- `Attendance` table/migration with unique worker/date, restricted worker deletion, date index and status/hour constraints.
- Explicitly authorized GET, batch PUT and DELETE routes. Invalid batches change no records or audit rows. Inactive workers appear only when recorded on the selected day.
- Pure decimal `PayrollCalculator`, component rounding half away from zero, worker overtime overrides including zero, and shared xUnit/Vitest vectors for daily and monthly examples.
- Audited changed-row upserts and clears, server-authoritative pay responses, and recoverable 409 responses for concurrent SQL write conflicts.
- S5 period-lock interface/stub with tests proving every write checks the guard within a transaction.
- Daily Attendance tab, UAE date picker, explicit Save day, three attendance states, live preview, hours validation, settings-driven shift note, loading/empty/error/success states, and Viewer read-only access.
- Unsaved date-change, internal-navigation and Back confirmation; browser unload protection; pending-save controls; automatic continuation of a blocked navigation after a successful save.

**Deviations from the plan:** No scope additions or dependency changes. The following contract details resolve implementation gaps in the written S3 design:

- A batch row with explicit `status: null` and zero hours clears attendance atomically with other edits. The status property is required; omission is rejected. This avoids partially saving a day through separate PUT and DELETE calls. SQL still stores only Present/Absent; standalone DELETE is also available.
- Today is the UAE business date (`Asia/Dubai`) on API and web. This prevents rejecting today's UAE attendance while UTC is still on the previous date.

**Decisions I made:**

- Return `{date,isFinalised,rows:[{worker,record,dailyPay}]}`; reuse the existing worker response and expose each daily pay component.
- Send/validate changed rows only. Reducing the configured maximum later does not force users to alter unrelated historical attendance.
- Use the installed React Router data router and `useBlocker` for reliable internal navigation/Back protection. No new packages were added.
- Keep ordinary last-save-wins edits; simultaneous unique/deadlock conflicts return 409. Optimistic version tokens are outside S3.

**Review and regression evidence:** Independent specification review, then code-quality review, followed by recheck. All findings addressed: contradictory nested vector expectations, unchanged-row validation, unsaved navigation loss, pending-save continuation, and mobile overflow from absolute screen-reader labels. Temporarily disabling write authorization and the month guard caused four expected failures (Viewer PUT/DELETE and locked Save/Delete); guards were restored and the full suite passed. A concurrent-upsert regression reproduced an EF-wrapped SQL deadlock returning 500 before the conflict handler fix.

**Browser check:** Real development API and SQL Server LocalDB, disposable Administrator/Viewer accounts and worker. Desktop and 375px checked. Saved Present/8h/2h OT = AED 104.44; saved 0.25h OT = AED 0.56, total AED 100.56; persisted values verified after reload/sign-in as Viewer. Basic hours 9 was refused; navigation opened the discard dialog and Cancel retained edits. Viewer had no status/hour editing or Save button. At 375px page scroll width equalled client width; the table/nav scrolled internally. No console warnings/errors recorded.

Local visual evidence (stored outside Git):

- Desktop: `C:/Users/User/.codex/visualizations/2026/10/20/01a15927-e524-7823-85be-9827cd515776/s3-attendance-desktop.png`
- Mobile: `C:/Users/User/.codex/visualizations/2026/10/20/01a15927-e524-7823-85be-9827cd515776/s3-attendance-mobile.png`

**Cleanup:** Only the two verification servers were stopped. Disposable `HrPayroll_Dev` was dropped after browser checks. Tests dropped their own databases; final SQL query returned **0 HrPayroll databases**. No seeded credentials or test records remain.

**Not done / known gaps:** S4–S8 remain. Finalisation does not exist yet: the production lock implementation intentionally returns Draft until S5. S5 must coordinate attendance writes and finalisation under the documented month-lock protocol. The pre-existing handover gaps remain outside S3. Deployment infrastructure and QuestPDF licensing still require their planned S4/S8 checks.

**Open questions:** None blocking S3. Existing client/hosting confirmations remain as documented in HANDOVER.md. Stopping at the handover's explicit end-of-S3 checkpoint before starting S4.
