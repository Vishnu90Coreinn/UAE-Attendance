# Phase 3, Stage 3: Expense and Income Tracking — build plan

Source: `docs/quotations/Phase3_QTN-HR-2026-005.pdf` (section 04, assumptions in 06, fee in 07). Stages 1 (Staff Attendance) and 2 (Leave) are delivered. This plan covers **Stage 3 only**: 8 working days, AED 1,320.00 before discount (AED 820.50 net, payable on delivery).

> **Which quotation is current.** Two Phase 3 PDFs sit in `docs/quotations/`, and both carry the number QTN-HR-2026-005. `Phase3_QTN-HR-2026-004.pdf` (saved 18 Nov) is an 8-stage, AED 6,967.50 scope that *replaces Daftra* (chart of accounts, ledger, VAT, cheques, migration). `Phase3_QTN-HR-2026-005.pdf` (saved 21 Nov) is the 3-stage, AED 2,182.50 scope where the books stay with the accountant and the app only *tracks*. This plan follows the **-005** file. Accounting, VAT, cheques and Daftra migration are optional Stages 6 to 10 in that file and are **out of scope** here.

## 1. What Daftra tells us (read-only look, 24 Nov 2026)

The connected Daftra account (`dabgac`) is the accountant's software. What it holds today:

| Item | Found in Daftra | Consequence for the plan |
|---|---|---|
| Bank / cash accounts | 2: one RAKBANK current account (AED, primary, account no. ending 3938001) and a cash treasury named "Main". No IBAN stored. Both show balance 0 | Seed the two accounts. **Opening balances cannot come from Daftra** (it reports 0), so the client must give them with a cut-over date |
| Expense categories | 9 active: Monthly Salary, Commission for Labor, DUBAI INSURANCE, Salary Advance, Government-related procedures for workers, Office Rent, Worker Transportation, Company expenses, Worker Accommodation Rent | Use as the starting list for the client to confirm. "Monthly Salary" and "Salary Advance" overlap with the HR payroll module, which Stage 3 does not link to, so ask whether to keep them |
| Income categories | **None.** The one income entry has no category and sits on a chart-of-accounts account | The client must supply the starting income categories |
| Volume | 272 expenses since August (about 80 a month), 1 income | Small. Plain SQL tables, no heavy tuning, no paging worries |
| Expense fields really used | date, amount, category, note (long free text), treasury, the supplier's invoice number in `expense_number` (e.g. `IN2630722`, `No. 0055`), and 1 to 2 attached PDF/JPG per entry. VAT fields and `vendor` are empty | Matches the quote (single total, no VAT). **The reference number matters to them**, so give expenses an optional Reference field like income has (same column, no extra work) |
| Suppliers | 3, two of them duplicates | The quote's "Paid to" is plain text. No supplier table |
| Draft / recurring / cost centres | Not used | Not needed |

Daftra's role in the build:
1. **Seed data**: accounts and categories above, confirmed by the client.
2. **Go-live check**: after the first full month on the new module, compare monthly expense and income totals per account with Daftra (read-only). Differences mean a missed entry on one side.
3. **No history import** (the quote excludes "entry of past expenses and income"). The 272 entries with receipts are reachable through Daftra's API, so a one-off import is a cheap change request **if** the client wants it. Otherwise pick a cut-over date and start clean.
4. Any live Daftra link is optional Stage 10 in the -005 quote and needs the client's API access. Not built here.

## 2. Scope (from section 04)

Bank and cash accounts · transfers · expenses with mandatory receipt · income with optional attachment · categories managed in Settings · lists with search and filters · void/correct with history · Manager month lock · dashboard · period report with Excel, PDF and CSV.

Not in scope: double-entry, VAT, approvals, suppliers, currencies other than AED, history entry, link to Tax Invoices.

## 3. Design

Follows the existing app: ASP.NET Core 10 + EF Core, React 19, same login, audit log, ClosedXML for Excel, the existing PDF canvas, phone shell for 375px. Tables are prefixed `Fin`.

### Tables

| Table | Key columns and rules |
|---|---|
| `FinAccounts` | Name, Kind (`Bank`/`Cash`), AccountNumber, Iban, OpeningBalance `decimal(12,2)`, OpeningDate, IsActive, SortOrder. Name unique. Never deleted, only deactivated |
| `FinCategories` | Kind (`Expense`/`Income`), Name, IsActive. Unique (Kind, Name, case-insensitive). Rename and switch off allowed; never deleted once used |
| `FinEntries` | Kind, EntryNo (`EXP-000001` / `INC-000001`), EntryDate (`date`), CategoryId, Party (paid to / received from), AccountId, Amount `decimal(12,2)` CHECK > 0, Reference (optional on both kinds), Notes, **Status** (`Active`/`Voided`), VoidReason, VoidedBy/Utc, **ReplacesEntryId** (self FK), CreatedBy/Utc |
| `FinTransfers` | TransferNo, TransferDate, FromAccountId, ToAccountId (CHECK different), Amount > 0, Reference, Notes, Status, void fields, ReplacesTransferId, created fields |
| `FinAttachments` | EntryId FK, FileName, ContentType, SizeBytes, StoredName and Sha256 (file kept in a server folder, see section 6 point 2; the first draft used `varbinary(max)`), UploadedBy/Utc. Kept apart from `FinEntries`, so lists never touch the files. Expense must have at least one; income may have none |
| `FinMonthLocks` | Year, Month (unique), LockedBy, LockedUtc, UnlockedBy/Utc/Reason (history kept) |

Money is `decimal(12,2)`, never `double`. Dates use `DateOnly`, shown in UAE time.

### Rules (all in one pure `FinanceCalculator`, shared vector file `docs/finance-test-vectors.json` read by both xUnit and the web tests)

- **R1 balance** = opening balance + Active income into the account − Active expenses from it + Active transfers in − Active transfers out. A transfer is never expense or income.
- **R2** Voided rows count nowhere (balances, dashboard, reports). They stay visible in lists behind a "Show voided" filter.
- **R3 correct** = one transaction that voids the original and inserts a replacement with `ReplacesEntryId` set. The chain is kept; the audit log records who and when. There is no delete endpoint.
- **R4** An entry date cannot be before its account's OpeningDate or in a future month, and **cannot fall in, or be moved out of, a locked month**. Same for voiding and for transfers (both accounts' dates).
- **R5 month lock**: Manager or Administrator locks and unlocks (decided by the owner). A write inside a lock returns 409. Unlock needs a reason, and lock/unlock are kept in the audit log with who and when.
- **R6** An expense is refused without an attachment. Allowed files: PDF, JPEG, PNG, up to 5 MB, content checked by magic bytes (as `PhotoUpload` does), not by file name.
- **R7** An account with entries cannot be deleted or have its opening balance changed after a month is locked.
- Inactive accounts and categories are not offered for new entries but still show on old ones.

### Access (follows section 05, using today's fixed roles)

| Role | Accounts, expenses, income, reports | Account no. / IBAN |
|---|---|---|
| Administrator, Manager | view and edit | full |
| Partner (`Viewer`) | view only (the existing read-only middleware already refuses writes) | masked, last 4 digits |
| HR, Supervisor, Employee | no access | none |

New policies `FinanceView` and `FinanceEdit`. A role-matrix test per route (anonymous 401, forbidden 403, allowed success) as the house style requires. Masking goes through a small redactor like `WageRedactor`.

### API (all under `/api/finance`)

`accounts` (GET, POST, PUT, activate/deactivate) · `transfers` (GET, POST, void, correct) · `categories` (GET, POST, PUT, activate/deactivate) · `entries?kind=&from=&to=&categoryId=&accountId=&min=&max=&q=&includeVoided=` (GET list) · `entries` (POST as multipart: fields + receipt file) · `entries/{id}` (GET, PUT = correct, `POST …/void` with reason) · `entries/{id}/attachments/{aid}` (GET stream; viewable inline for the receipt preview) · `months/{yyyy-MM}/lock` (POST, DELETE with reason) · `dashboard` · `reports/summary?from=&to=` with `format=json|xlsx|pdf|csv`.

### Screens

New nav group **Finance**: Dashboard, Expenses, Income, Accounts (accounts + transfers), Reports. Category and month-lock controls live in Settings (new card, Manager and Administrator). Phone: entries become cards, the Add button sits in the bottom area, and the receipt field opens the camera directly (`capture="environment"`); photos are downscaled in the browser like the selfie code. Table text 14px, form text 16px, 44px touch targets, status never by colour alone, per `docs/design-system.md`.

### UI standard for every finance screen (owner requirement)

- **Always run the `/ui-ux-pro-max:ui-ux-pro-max` skill** before designing or changing any finance screen, component or report layout, in every slice (F1 to F6). It is a step in each slice, not a final polish pass.
- **No generic AI look.** No default card grids, no stock dashboard of identical tiles, no decorative gradients or filler icons. Each screen needs a clear point of view: it should be creative, modern and inspiring, and **built around the data and the person using it**.
- **Data first.** The number the user came for is the largest thing on screen (balances, net result, the amount in a list row). Amounts are right-aligned, tabular figures, AED with two decimals, negative and voided states shown by label and shape as well as colour. Charts only where they answer a question (spending by category, income against expense over time) and are labelled directly instead of relying on a legend.
- **Fast entry is the main job.** Adding an expense takes as few taps as possible: last-used account and category pre-selected, camera opens straight from the receipt field on a phone, amount field first with a numeric keypad, the receipt preview next to the form on a laptop.
- **Good states, not just the happy path**: empty (first expense), loading, error, locked month (say why and who locked it), voided and corrected entries (the chain is visible), and a long list that is quick to scan and filter.
- **Still inside the app's identity**: keep the existing colours, type and navigation (`docs/design-system.md`), the phone shell and the accessibility rules (labels, focus outlines, 44px targets, contrast, nothing sideways-scrolling at 375px). The quote says final screens follow the application's existing style, so the creativity goes into layout, hierarchy and interaction, not a new brand.
- **Show the design before building it.** For each slice, produce a short design direction (and a quick visual mock-up for the dashboard and the entry form) for your review before the screens are coded. Verify the result in the browser at desktop and 375px, as Manager and as Partner, and look at it, not just run the tests.

## 4. Slices (same cadence as S0 to S5: own branch, small commits, report each)

| Slice | Days | Delivers | Exit check |
|---|---|---|---|
| **F1 Accounts, categories, transfers** | 1.5 | Entities and migration for all `Fin*` tables (Status and `ReplacesEntryId` columns included now so later slices need no rework), policies, redactor, Accounts page with live balances, Settings card for categories, seed of the 9 expense categories and "Other income". **Built (24 Nov):** the two accounts are not seeded, because opening balances and dates are unknown; a Manager adds them on the Accounts page. `FinAttachments` and `FinMonthLocks` arrive with F2 and F4 | Balance vectors pass; transfer moves both balances; Partner sees masked numbers |
| **F2 Expenses and receipts** | 1.5 | Multipart create, attachment store and streaming, list with search and filters, receipt viewer, phone card layout | Expense without file refused; wrong file type refused; receipt opens from the list |
| **F3 Income** | 1 | Same screens with optional attachment, reference | Income raises the balance; no attachment needed |
| **F4 Corrections, void, month lock** | 1 | Void, correct (chain), lock and unlock, 409 handling, voided filter | Lock blocks add, edit, void and transfer in that month; correction leaves the original with who/when |
| **F4b Daftra import** | 1 | One-off admin command, dry run, receipt download, `ExternalId` guard (section 7). Quoted to the client as a change request | Row counts, monthly totals and bank balance match |
| **F5 Dashboard** | 1 | Total balance, per-account balance, income / expense for 7, 30, 365 days, net, spending by category, latest entries | Numbers equal the report for the same period |
| **F6 Reports and export** | 1.5 | Period report by category and by account with opening and closing balances; Excel (ClosedXML), PDF, CSV; CSV is UTF-8 with BOM so Excel opens it | The three formats show identical figures |
| **F7 Final test, migration, deploy** | 0.5 | Full verification, migration script, deploy per `docs/DEPLOY.md`, seed with the client's opening balances, Daftra month-total check | Clean LocalDB afterwards; production backup taken first |

Order is F1, F2, F3, F4, F5, F6, F7. F4 comes right after the entry screens so every later screen is built on top of the final void and lock rules.

Each slice: run `/ui-ux-pro-max:ui-ux-pro-max` for its screens first (see the UI standard above), then failing test first on real SQL Server (no EF InMemory), run the focused tests while building, one full pass at the end (`dotnet build` 0 warnings, `dotnet test`, `npm test`, `npm run lint`, `npm run build`), then check in the browser at desktop and 375px as Manager and as Partner.

## 5. Needed from the client before F1 (section 06 says they supply these)

| # | Item | Default if not answered |
|---|---|---|
| 1 | **Cut-over date and opening balance** for the RAKBANK account and the cash account (Daftra shows 0) | Nothing can go live; this is the one hard blocker for F7, not for F1 to F6 |
| 2 | Starting **income categories** (Daftra has none) | Seed one "Other income" so the screen works |
| 3 | Confirm the 9 expense categories; keep "Monthly Salary" and "Salary Advance"? | Seed all 9 |
| 4 | The IBAN for each account (Daftra has none) | Left blank |
| 5 | Who may see account numbers and IBAN | Administrator and Manager; masked for Partner |

## 6. Decisions

**Decided by the owner (24 Nov 2026):**
- Access uses today's fixed roles (Manager and Admin edit, Partner views). No configurable matrix.
- Merge `feat/phone-ui-redesign` first, then cut `feat/finance-accounts` from the result.
- Daftra history is imported as slice F4b (change request, about 1 day).
- Receipts are stored in a server folder, not the database.
- A Manager can unlock a month, with a reason (differs from my recommendation of Administrator only; audit log keeps who and why).
- Expenses get an optional Reference field.
- Account numbers and IBAN: Administrator and Manager only; Partner sees them masked.
- Seed Daftra's 9 expense categories and one "Other income" category; the client edits them in Settings.

**Still open (for the client, not for the build):** opening balances and cut-over date for both accounts, IBANs, and whether to keep "Monthly Salary" and "Salary Advance".

The points below are kept as the original discussion record.

### Original points

1. **"Roles & Permissions settings".** Section 05 promises a per-role No access / View only / View and edit setting for the new modules. I found no such screen in the code: roles are fixed (`Roles.cs`, `Policies.cs`). Stage 3 as planned uses fixed roles that match the quote's sentence (Manager and Admin edit, Partner views). Building a real configurable matrix is a separate piece of work. Do you want it, or did Stages 1 and 2 already agree on fixed roles?
2. **Attachment storage.** Existing code keeps files in the database (`LeaveAttachment`, `StaffPunchSelfie`). The one Daftra receipt I fetched was 1.2 MB, so at about 80 receipts a month (and up to 2 files each) receipts could add roughly 1 GB a year, plus a few hundred MB for the history import. Production runs SQL Server Express, which stops at 10 GB and also holds the selfies. That makes the database a poor home for receipts. **Revised recommendation: store receipt files in a folder on the server** (path in configuration, outside the web root, file name = random id, size and type checked on upload), keep only the metadata and a hash in `FinAttachments`, and add that folder to the backup routine in `docs/DEPLOY.md`. Browser-side downscaling of phone photos keeps images small; PDFs are stored as uploaded.
3. **Unlock of a locked month**: Administrator only with a reason, as above. OK?
4. **Reference on expenses**, a small addition beyond the quote's field list, because Daftra shows it is how they find entries. OK?
5. **Branch base.** `feat/phone-ui-redesign` is checked out with 30 commits and an uncommitted `Program.cs`. Finance extends the phone shell and nav that branch changes, so I suggest merging it first and cutting `feat/finance-accounts` from the result.
6. **History from Daftra**: skip (as quoted) or a one-off import as a change request? See section 7: it is possible and small.

## 7. Importing the Daftra history: feasibility (checked 24 Nov 2026)

**Verdict: yes, it can be done, and it is small.** The quote excludes it ("entry of past expenses and income is not included"), so it is a change request. Size: about 1 working day. The old 18 Nov quote priced "open items and expense history import" at 1 day, AED 165.

### What Daftra holds

| Data | Count | Notes |
|---|---|---|
| Expenses | 272 (dated 1 Jun to 23 Nov 2026; keyed in from 17 Sep, so many are back-dated) | All `issued`, no drafts, none recurring, no VAT, no cost centres |
| Income | 1 (AED 111,767.04, 23 Nov) | No category; booked to a chart-of-accounts account |
| Transfers between accounts | 0 | |
| Accounts | 2 (RAKBANK, cash "Main") | All sampled expenses use RAKBANK; I could not filter by account, so the cash account being unused is not confirmed |
| Receipts | Nearly every expense has 1 or 2 PDF/JPG files on Daftra's file store | Not yet fetched (see below) |

Expenses per category: Company expenses 191, Government-related procedures 47, Salary Advance 16, DUBAI INSURANCE 5, Worker Accommodation Rent 4, Worker Transportation 4, Monthly Salary 2, Commission for Labor 1, Office Rent 0. That adds up to 270, so **2 expenses have no category**.

### Field mapping

| Daftra | This app |
|---|---|
| `date` | EntryDate |
| `amount` | Amount (all AED) |
| `expense_category_id` | Category by **id**, not by the name copied on the row (old rows still carry old names, e.g. "Worker accommodation rent and transportation") |
| `treasury_id` | Account |
| `vendor` (usually empty; "GOVERNMENT" on some) | Paid to |
| `expense_number` (supplier invoice no., cheque no., licence no., or a counter such as `0017`) | Reference. **Not unique and not consistent**, so no uniqueness rule on it |
| `note` (long, multi-line) | Notes (allow 2,000 characters) |
| `attachments` | FinAttachments |
| `id` | New column `ExternalSource = 'Daftra'`, `ExternalId`, unique together: re-running the import never creates duplicates |
| Income `journal_account_id` | Ignored (no ledger in this app); client picks the income category |

### Things that need a decision or special handling

1. **Receipts are mandatory in this app but the files live in Daftra.** The import has to download them. **Tested on one receipt (24 Nov): it works with no login.** The Daftra link answers with a redirect to a temporary signed link on Daftra's own file storage, and that served a 1.2 MB PDF. So a script can fetch all of them. The signed link expires after about 100 minutes, so the script must ask Daftra for a fresh link per file and never store the link. A file that cannot be fetched is imported with a "legacy, no receipt" flag, so rule R6 needs an exemption for imported rows only.
2. **"Paid to" is empty on almost every Daftra expense** while the quote makes it a field. Imported rows get the vendor if present, otherwise "(not recorded)".
3. **Quality of categories**: 70% (191 of 272) sit in the catch-all "Company expenses", including salary-like and medical items. They import as they are. Re-categorising is a client task afterwards. The 2 uncategorised rows go to "Company expenses".
4. **Balances cannot be copied**: Daftra shows 0 for both accounts. Opening balance has to be the real bank balance at the day before the first imported entry (31 May if importing from 1 Jun). Then **the balance this app computes today should equal the RAKBANK statement balance**, which makes a strong correctness check on the whole import.
5. **Month lock**: after the import, lock the fully imported months so the history cannot be edited by accident. This is why the import runs after F4 (lock exists), not before.
6. **Daftra stays live until cut-over.** Entries keyed into Daftra after the export would be missing, so the import is run twice: once to prove the numbers, once on cut-over day. The `ExternalId` rule makes the second run add only the new rows.

### How it would run

A one-off admin command in the API project (not a screen), reading a JSON file plus a folder of receipts. It has a dry run that prints counts, totals per month, per category and per account, and a list of rows it would skip. The app itself needs no Daftra API key: I can pull the records through the connector I have (about 7 pages), or the accountant can export from Daftra to Excel. Receipts are the only part that needs the client's Daftra login or an export from them.

### Where it fits

Add one slice after F4: **F4b Daftra import (1 day)**. Run the dry run during F6 review, and the real run in F7 together with the opening balances. Checks before sign-off: row counts equal (272 and 1), monthly totals equal Daftra's, balance equals the bank statement, every imported expense has a receipt or a visible legacy flag.
