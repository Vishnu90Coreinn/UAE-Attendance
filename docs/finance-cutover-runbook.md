# Finance cut-over runbook: from Daftra to this app

For DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C. Plain steps, in order. Nothing here is done yet.

Companion documents: `docs/finance-chart-of-accounts.md` (the starting chart, how each thing is booked, and the Daftra crosswalk for the opening balances), `docs/phase4-ledger-plan.md` (what the books do), `docs/DEPLOY.md` (how to release), `docs/finance-client-roadmap.md`.

## Agreed dates

- **Cut-off: 31 December 2026.** The last day entered in Daftra.
- **First day in the new app: 1 January 2027.** Opening balances are as at 31 December 2026, so the new books start on the first day of the financial year and of the first VAT quarter of 2027. The new app never has to close 2026; the accountant does that in Daftra.
- The first financial year in the new app is 2027. Year-end close first applies after 31 December 2027.

## Timeline

| When | What |
|---|---|
| By early December | Merge PR 37, back up, deploy to production, check `/api/health` and the Books banner (section 6) |
| Early to mid December | Dry run on a restored copy (section 5). Train the people who will enter expenses and approve them |
| Mid December | Create the accounts (opening date **1 January 2027**), partners, categories, mapping and VAT defaults (section 3, steps 1 to 4) with provisional zero balances |
| 31 December | Last entries in Daftra. The accountant closes December in Daftra |
| From 1 January | Staff enter everything in the new app only. Entries dated 1 January or later are accepted before the opening balances are final |
| When the signed 31 December trial balance is ready | Enter the real opening balances and the opening journal (section 3, steps 1, 2 and 5 to 7), then run the checks in section 7. Opening balances can be edited until the first month is locked |
| End of January | Compare with Daftra if it is still running (section 8), then lock January |

Entering the opening balances after the first entries is safe: an account's opening balance and date, and a partner's opening capital, can be changed until any month is locked, and the books are derived again. Do not lock a month before the opening position is final.

## 0. The idea in one paragraph

On the cut-over date (1 January 2027) the books in this app start from the closing balances of Daftra at 31 December 2026. From then on every entry is made here only. If the accountant wants a safety net, January can be run in both systems and compared before Daftra is switched off. If the client goes fully to the new app from 1 January, the comparison is the opening position (section 7) and the first VAT return.

## 1. Decisions needed before anything is entered

| # | Decision | Who | Why it matters |
|---|---|---|---|
| 1 | Cut-over date | Client | **Decided: 1 January 2027**, opening as at 31 December 2026 |
| 2 | Run January in both systems, or go fully to the new app from 1 January? | Client and accountant | Daftra is switched off only after sign-off |
| 3 | VAT type for each expense and income category | Accountant | Sets the default VAT type on each category (Books are wrong quietly if a category is mapped wrongly) |
| 4 | Is reverse charge VAT 5% for this company? | Accountant | Affects the VAT return |
| 5 | Prepaid rent: expense when paid, or spread over the months? | Accountant | We expense when paid today; spreading needs a manual journal each month |
| 6 | Which ledger account each category posts to (from the Daftra chart of accounts) | Accountant | Books > Where records post |
| 7 | Do any customer invoices stay unpaid at cut-over? | Client | None are expected (Daftra holds no 2026 invoices). If there are, see section 4 |
| 8 | Who may enter expenses from their own login, and who approves | Client | Settings > Staff who can enter expenses |

## 2. What to collect from Daftra (as at the day before cut-over)

1. **Chart of accounts** export (names and codes).
2. **Trial balance** as at that date, signed by the accountant. This is the single source for everything below.
3. **Bank and cash balances**: the book balance in Daftra and the real bank statement balance, for each account.
4. **Cheques not yet cleared**: serial, payee, amount, issue and due date, issued or received.
5. **Each partner's capital** (and any current account balance).
6. **VAT**: the net VAT payable (or recoverable) at that date, and the date of the last VAT return filed.
7. **Retained earnings brought forward** (profit or loss of all closed years).
8. **Any other balance sheet lines** the trial balance shows (supplier balances, prepaid items, deposits, loans).

## 3. Entering the opening position (an Administrator or Manager)

Do this in a **test copy first** (section 5), then again in production. Order matters.

0. **Check for invoices already issued in the app.** Open Tax Invoices. Every invoice that has been issued (test or real) posts its sale, VAT and receivable to the books on its **invoice date**, even when that is before the cut-over date, and would then be counted twice with the Daftra balances. Cancel any test invoices (the books reverse them) and make sure a real one is not also in the opening journal. Payments entered on an invoice before this version are marked "Not in the books"; they are not posted.
1. **Accounts.** Finance > Accounts: one account per bank, cash and petty-cash. Opening balance = the **Daftra book balance** at the day before cut-over, opening date = the cut-over date.
2. **Partners.** Opening capital for each partner, as at the same date.
3. **Categories.** Settings > categories: check the expense and income categories match how the client works. Then Books > *Where records post*: point every category, account and partner at the ledger account the accountant chose. Do this **before** any month is locked: it is refused afterwards.
4. **VAT defaults.** Settings > Expense and income categories: set the VAT type per category (decision 3).
5. **Opening journal for everything with no screen.** Books > Journals > New journal, dated the **cut-over date**, one journal for the whole opening trial balance, using *Opening balance equity (3900)* as the balancing line:
   - VAT payable or recoverable (2200 or 1500), from item 6. It is paid or refunded later with the categories *VAT paid to tax authority* and *VAT refund from tax authority* (see `docs/finance-chart-of-accounts.md`).
   - Retained earnings brought forward (3800), from item 7.
   - Anything in item 8 (supplier balances, prepaid items, loans). The starting chart already has accounts for prepaid expenses, deposits, fixed assets, accrued expenses and wages and loans; see the crosswalk in `docs/finance-chart-of-accounts.md`. Prepaid items are spread afterwards with a monthly journal (Books > Monthly journals).
   - **Do not** post to *Accounts receivable (1550)* or *Accounts payable (2300)* by hand: they must equal the unpaid invoices and unpaid bills in the app, and a safety check fails otherwise. Enter unpaid supplier bills under Finance > Bills instead (section 4).
   - Bank, cash and partner capital are **not** in this journal; steps 1 and 2 already post them.
6. **Check the opening position.** Books > Trial balance as at the cut-over date must agree with the Daftra trial balance, line by line. *Opening balance equity (3900)* should come to **zero**. If it does not, something is missing or entered twice: fix it before going on.
7. **Cheques.** Finance > Cheques: enter each uncleared cheque from item 4. Leave them **not linked to an entry**: the expense was already in Daftra, and the opening bank balance is already net of it. They then track when the bank pays them and change nothing in the books. (The "bank statement" line on the account will show the book balance, not the statement, until they clear. That is expected.)
8. **Staff expense entry and petty cash**, if used: tick the staff allowed to enter expenses, and hand out petty cash as a transfer.
9. **Excel import** of earlier history is optional and not needed for the cut-over.

## 4. If customer invoices or supplier bills are unpaid at cut-over

**Supplier bills:** enter each unpaid bill under Finance > Bills with its original date and the supplier's invoice number; it books the cost, VAT and the debt. Do not also put it in the opening journal, and do not enter its cost again as an expense. The bill date must fall in a month that is not locked.

**Customer invoices:** issue them in the app with their **original dates** and numbers (the invoice screen accepts a typed number), then record payments as they arrive. Their sale is then booked once, here. Do not also put them in the opening journal. The date must fall in a month that is not locked.

## 5. Dry run on a copy (do this before production)

1. Restore a recent **production backup** into a spare database (never the live one).
2. Point a test copy of the site at it (`ConnectionStrings__Default`) and let it migrate on start.
3. Enter the opening position from section 3 and run the checks in section 7.
4. Throw the copy away, or keep it as the practice environment.

## 6. Releasing the code to production

Run `dotnet ef migrations list --project apps/api` against production to see which migrations are pending. The finance ones run from `AddFinance` to `AddInvoiceReceivables`; the newest are `AddFinPayeesAndEntryLines`, `AddFinCheques`, `AddStaffExpenseEntry`, `AddFinCustodyAccounts`, `AddLedger`, `AddLedgerManualJournals`, `AddVatAndChequeBooks` and `AddInvoiceReceivables`. `AddVatAndChequeBooks` changes a database constraint on journals.

1. **Back up first**: the SQL database **and** the receipts folder (`Finance__ReceiptsPath`). Check the backup file exists and is not empty.
2. Merge PR 37 into `master`. CI runs the tests and the **Deploy to IIS** job copies the release, shows `app_offline.htm` meanwhile and checks `/api/health` (see `docs/DEPLOY.md` section 9).
3. With `Database:MigrateOnStartup` on, the site migrates when it starts. Confirm `/api/health` returns `database: ok`.
4. Sign in as the Administrator and open Books. The banner must say the books agree. The first visit builds the system accounts (VAT, cheques, receivables, retained earnings); this takes a moment.
5. **Rollback**: redeploy the previous release folder. Migrations only go forward, so if one must be undone, restore the backup taken in step 1.

## 7. Checks before anything is locked

| Check | Where | Pass when |
|---|---|---|
| Books agree with the finance screens | Books banner | green, all checks passed |
| Opening trial balance | Books > Trial balance at cut-over date | equals Daftra's, line by line; 3900 is zero |
| Bank and cash | Finance > Accounts | balance equals Daftra's book balance; after cheques clear, equals the bank statement |
| Partner capital | Finance > Partners | equals Daftra |
| Journals balance | Books banner | debits equal credits |
| Backup restores | Test copy | the restored database opens and shows the same totals |

## 8. The parallel month

1. Enter everything in **both** systems for the month.
2. At month end compare, with the accountant: the **trial balance**, **profit and loss**, **balance sheet**, the **VAT return** (Finance > VAT) and each bank balance against the statement.
3. Differences are explained and fixed in this app (a void or a correction, never a delete) or noted as a Daftra error.
4. When the figures agree, the accountant signs. Then **lock the month** (Settings > Month lock), starting with the cut-over month.

Use the same month to try the routine jobs once: a VAT return download, an Excel and PDF of the reports, a staff expense through approval, a cheque from issue to clear.

## 9. Switch-off

1. Accountant's written sign-off of the parallel month.
2. Stop entering in Daftra from the next day.
3. Export Daftra reports and data and keep them read-only. Ask the accountant how long records must be kept; UAE VAT records are generally kept for at least five years.
4. Cancel the Daftra subscription only after the first VAT return from this app has been filed and accepted.
5. Year-end: after 31 December, Books > Year end > Close year (needs every staff expense approved or rejected first).

## 10. Risks to watch

- **A wrong category mapping** makes the books wrong quietly. The accountant signs the mapping before go-live; the Books banner checks the rest.
- **Entering the opening twice** (bank balance and again in the opening journal): 3900 will not be zero.
- **Cut-over in the middle of a month**: avoid; the parallel month then straddles two months.
- **Daftra bank balances**: use the **book** balance, not the statement, as the opening balance when cheques are outstanding.
- **Locking too early** blocks fixing the opening position. Lock only after sign-off.
- **Receipts folder**: it is not in the database. A backup without it loses every receipt photo.
