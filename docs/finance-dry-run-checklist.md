# Dry-run day checklist

Do this once, on a **copy** of production, before the real opening balances are entered. Allow half a day. It proves three things: the new migrations run on real data, the books balance on a realistic month, and the backup can be restored. Nothing here touches the live site. Background: `docs/finance-cutover-runbook.md` (sections 5 to 7).

Tick each box. If one fails, stop, write down what you saw, and do not go live until it is fixed.

## A. Before you start

- [ ] PR 37 is merged and the release package is built (CI artifact `hr-payroll-iis`, or `./scripts/publish-iis.ps1`).
- [ ] A fresh production backup exists: the SQL database **and** the receipts folder (`Finance__ReceiptsPath`). Check the file sizes are not zero.
- [ ] A spare machine or folder and a spare database name (for example `HrPayroll_DryRun`). Never the live database or the live receipts folder.
- [ ] The accountant (or whoever signs) is available for section F.

## B. Make the copy

- [ ] Restore the backup into the spare database (`RESTORE DATABASE ... WITH MOVE`, new file names).
- [ ] Copy the receipts folder to a new path, for example `D:\DryRun\receipts`.
- [ ] Point a copy of the release at the spare database. Set, for this copy only: `ConnectionStrings__Default` (the spare database), `Finance__ReceiptsPath` (the copied folder), `Jwt__Key`, `ASPNETCORE_ENVIRONMENT=Production`, and `Database:MigrateOnStartup=true`.
- [ ] Start it. Open `/api/health`: it must say `database: ok`. The first start applies all pending migrations; note how long it took and that there was no error in `logs`.
- [ ] Sign in as the Administrator. Existing HR data (workers, attendance, payroll) is still there and unchanged.

## C. Enter a made-up month

Use invented names and round numbers, so nothing can be mistaken for real books. Dates are in the current month, after the account opening date.

1. [ ] Finance > Accounts: add a bank account (opening 100,000.00) and a cash account (opening 5,000.00), opening date **1 January 2027** or any earlier date.
2. [ ] Finance > Partners: add two partners whose opening capital adds up to **80,000.00**.
3. [ ] **Expense with VAT.** 1,050.00 in a category that has the standard VAT default, paid from the bank, receipt attached. Check the VAT shown is 50.00.
4. [ ] **Split expense.** 3,000.00 split across two categories.
5. [ ] **Income.** 2,100.00 with VAT added on top.
6. [ ] **Supplier bill** under Finance > Bills: 2,000.00 plus 5% VAT, with a PDF invoice attached. Pay half of it from the bank. Take the payment back and pay it again.
7. [ ] **Tax invoice** under Tax Invoices: issue one for 1,000.00 plus VAT, record a part payment into the bank account.
8. [ ] **Cheque.** Add an issued post-dated cheque linked to the expense in step 3. Check the account shows a "bank statement" line that is higher than the book balance by the cheque amount. Mark it cleared and check the two agree.
9. [ ] **Petty cash.** Hand 500.00 to a staff member (a transfer), then enter an expense against it.
10. [ ] **Staff entry.** Sign in as a staff member allowed to enter expenses, submit one, sign in as a Manager and approve it. Check it counts nowhere until approved.
11. [ ] **VAT settled.** Enter one *VAT paid to tax authority* expense from the bank.
12. [ ] **Monthly journal.** Books > Monthly journals: set up a small prepaid spread (debit insurance, credit prepaid expenses) and press Post due months.
13. [ ] **Opening journal.** Bank and cash (105,000.00) and partner capital (80,000.00) leave 25,000.00 in *Opening balance equity (3900)*. Books > Journals > New journal, dated the opening date: debit *Opening balance equity (3900)* 25,000.00, credit *Retained earnings (3800)* 25,000.00. That is the pattern of the real opening journal in the runbook.

## D. The checks

- [ ] **Books banner** is green and every check passes (accounts, partner capital, receivables, payables, debits equal credits).
- [ ] **Trial balance:** debits equal credits. *Opening balance equity (3900)* is **zero** after step 13.
- [ ] **Bank and cash balances** on Finance > Accounts equal your hand calculation (opening plus income minus expenses, adjusted for transfers and capital).
- [ ] **Receivables** total equals what remains unpaid on the tax invoice. **Payables** total equals what remains unpaid on the bill.
- [ ] **VAT return** (Finance > VAT) for the month: output VAT = the sale's VAT plus the invoice's VAT; input VAT = the expense's and the bill's VAT; the VAT settlement entry is not in it.
- [ ] **Profit & Loss** and **Balance Sheet** open; the balance sheet balances.
- [ ] **Downloads:** Excel, PDF and CSV of the trial balance, the VAT return and one finance report all open and show the same figures as the screen.
- [ ] **Lock a month**, try to add an entry in it (refused with a clear message), unlock it with a reason.
- [ ] **Void** one expense and check the books banner stays green.
- [ ] Open three receipts from earlier (before the migration) and the supplier invoice you attached: all open.

## E. Phone and permissions

- [ ] Open the site on a phone. Sign in, enter an expense with a photo, and see it in the list.
- [ ] A **Viewer** (the read-only partner) can see Books and reports and has no buttons that change anything.
- [ ] A **Supervisor** or **HR** user cannot open the finance pages.

## F. Restore test and sign-off

- [ ] Take a backup of the dry-run database, restore it to a second spare name, start it, and check the totals match (the backup really restores).
- [ ] Walk the accountant through the Books tabs and the VAT page and note anything unclear. Record the questions.
- [ ] Time it: how long did the migration take, and how long will the live deploy window be?

## G. Clean up

- [ ] Stop the copy. Delete the spare databases and the copied receipts folder (they hold real HR data).
- [ ] Write down the result: passed, or the list of problems with dates and what was seen.
- [ ] If anything failed, fix it, then repeat the checks that failed before deploying.

## Pass means

Every box in D and E is ticked, the restore in F worked, and nothing in the migration log looked wrong. Then the live deploy follows `docs/DEPLOY.md` section 10, and the real accounts, opening balances and opening journal are entered as in the runbook.
