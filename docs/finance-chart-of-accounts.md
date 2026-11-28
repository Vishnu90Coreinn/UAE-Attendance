# The chart of accounts and how the books work

For DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C and its accountant. This is how the new app keeps the books. It is not a copy of Daftra: staff keep entering simple things (an expense in a category, an invoice, a bill) and the app turns each into a balanced journal by itself. The chart below is what the app starts with. The accountant can rename an account or add new ones under Books > Chart of accounts, and change where a category posts under Books > Where records post.

## 1. The starting chart

Accounts the app makes and keeps (their codes are fixed; the names can be changed):

| Code | Account | Type | What posts there |
|---|---|---|---|
| 1100 and up | One account per bank, cash or petty-cash account | Asset | Opening balance, income, expenses, transfers, capital. Made automatically, in order |
| 1500 | VAT recoverable (input VAT) | Asset | VAT on purchases, expenses and supplier bills |
| 1510 | Employee salary advances | Asset | "Salary Advance". Moved to salaries by journal when deducted from pay |
| 1550 | Accounts receivable | Asset | Unpaid tax invoices. Cleared by payments recorded on the invoice |
| 1600 | Cheques receivable | Asset | Cheques received that the bank has not yet paid in |
| 1700 | Prepaid expenses | Asset | Paid in advance (annual insurance, rent). Spread with a monthly journal |
| 1750 | Security deposits paid | Asset | Deposits that come back. By manual journal |
| 1800 | Fixed assets (at cost) | Asset | By manual journal |
| 1850 | Accumulated depreciation | Asset (credit) | Monthly depreciation journal |
| 2150 | Cheques payable | Liability | Cheques written that the bank has not yet paid |
| 2200 | VAT payable (output VAT) | Liability | VAT charged on sales, and the reverse-charge pair |
| 2300 | Accounts payable | Liability | Unpaid supplier bills. Cleared by payments on the bill |
| 2400 | Accrued expenses | Liability | By manual or monthly journal |
| 2450 | Accrued wages | Liability | By manual or monthly journal |
| 2500 | Loans payable | Liability | By manual journal |
| 2550 | Customer advances | Liability | Money received before the work is invoiced. By manual journal |
| 3100 and up | One capital account per partner | Equity | Capital put in and paid back. Made automatically |
| 3800 | Retained earnings | Equity | Year-end close moves each year's profit or loss here |
| 3900 | Opening balance equity | Equity | The balancing line of the opening journal. Should be zero once the opening is entered |
| 4100 | Other income | Revenue | The "Other income" category |
| 4900 | Sales (tax invoices) | Revenue | Issued tax invoices, before VAT |
| 5100 | Salaries and wages | Expense | "Monthly Salary" |
| 5200 | Worker accommodation rent | Expense | "Worker Accommodation Rent" |
| 5210 | Worker transportation | Expense | "Worker Transportation" |
| 5220 | Office rent | Expense | "Office Rent" |
| 5300 | Government fees and worker procedures | Expense | "Government-related procedures for workers" |
| 5310 | Insurance | Expense | "Dubai Insurance" |
| 5320 | Recruitment commission | Expense | "Commission for Labor" |
| 5400 | General company expenses | Expense | "Company expenses" |
| 5500 | Depreciation | Expense | Monthly depreciation journal |
| 5600 | Bank charges | Expense | A category can be pointed here |
| 5700 | Other expenses | Expense | A category can be pointed here |

A new category the client adds gets its own account automatically (the next free code, 4000s for income and 5000s for expenses) unless it is pointed at an existing one.

## 2. How each thing is handled

- **An expense or income entry.** Debit the category's account (or credit, for income) and credit or debit the bank or cash account. One line per split.
- **VAT.** One input and one output account. The VAT return (Finance > VAT) splits by tax type: Standard, Zero Rated, Exempt, Reverse Charge, Intra GCC. **Reverse charge** is worked out at 5% and posted as a matching pair (recoverable and payable), so it costs no cash. Daftra's 0% only describes the cash paid. **Amendments** are made with a manual journal. **Excise** is not supported; it does not apply to this business.
- **VAT recovery.** An expense or supplier bill with standard or reverse-charge VAT has a recovery percentage (100 unless changed). Only a Manager or Administrator sets it: a staff expense arrives at 100, and if its VAT is blocked the Manager approves it and then uses Correct to change the percentage. The part that cannot be reclaimed is added to the cost and left out of the VAT return's reclaimable figure.
- **Paying VAT to the tax authority, and refunds.** Two ready-made categories: *VAT paid to tax authority* (an expense entry from the bank that debits VAT payable, 2200) and *VAT refund from tax authority* (an income entry that credits VAT recoverable, 1500). They carry no VAT of their own, are not a cost in the Books profit and loss, are not part of the VAT return, and are not offered to staff or on supplier bills. When a return is filed, the accountant nets the quarter with a manual journal (debit 2200, credit 1500 for the input VAT claimed), then the payment of the net amount is entered with *VAT paid to tax authority*. The VAT payable brought forward at 31 December 2026 is paid the same way in January. The finance screens (cash) show the payment as money out; only the Books know it is not a cost.
- **Tax invoices.** Issuing one debits receivables and credits sales and output VAT. A payment recorded on the invoice (with the account it went into) debits the bank and credits receivables.
- **Supplier bills.** Entering a bill debits the expense and input VAT and credits payables. Paying it debits payables and credits the bank. One payables account; the supplier is tracked on each bill with an aging report.
- **Cheques.** A cheque linked to an expense sits in cheques payable (or receivable) until it clears, so the bank in the books matches the bank statement.
- **Partners.** Capital put in and paid back posts to the partner's own equity account. Profit is not shared out by the app; the year-end close puts the whole result in retained earnings.
- **Petty cash.** Each staff member's petty cash is its own asset account. Handing cash over is a transfer, so the company total does not change.
- **Salary advances** are money the employee owes back, so paying one is not a cost: it goes to *Employee salary advances (1510)*. Payroll does not post to the books, so nothing clears it by itself. Each month, after payroll, the accountant posts a journal (Books > Journals > New journal) for the advances deducted from pay: debit *Salaries and wages (5100)*, credit *Employee salary advances (1510)*. The salary entry itself stays the amount actually paid. A fixed instalment can be a monthly journal instead (Books > Monthly journals). Until the journal is posted, the finance screens (cash) show the advance as money out while the Books profit and loss does not show it yet.
- **Customer advances (2550)** is for money received before the work is invoiced. Nothing posts there by itself.
- **Journals and the books check.** The Books banner compares each bank, cash and partner account, receivables and payables with the finance screens, journals posted by hand included. A manual or monthly journal that touches one of those accounts turns the banner red: record the money as an entry, transfer or capital movement instead. The one planned exception is clearing an old invoice payment (see the cut-over runbook, section 3).
- **Prepaid and spread items, depreciation, accruals.** Use **Books > Monthly journals**: set up the debit and credit once, with a day of the month and a first and last month, then press **Post due months** each month. Nothing posts in the background, and a locked month is left and reported. Example: AED 12,000 of insurance paid in January: pay it as an expense to *Prepaid expenses (1700)* using a category pointed there, then a monthly journal debits *Insurance (5310)* and credits *Prepaid expenses (1700)* for AED 1,000 from January to December.
- **Year end.** Books > Year end closes each finished year (31 December): locks the months and moves the result to retained earnings.

## 3. Crosswalk from Daftra (used once, for the opening balances)

The new app does not use Daftra's codes. When the opening position is entered (see `docs/finance-cutover-runbook.md`), each Daftra balance goes to the account in this table.

| Daftra | New app |
|---|---|
| Main (1201001), bank account (1202001) | The bank and cash accounts created in Finance > Accounts, opened with the Daftra book balance |
| Partner accounts (33, 34, 35) and Capital (31) | Each partner's opening capital in Finance > Partners |
| Retained Earnings (32) | 3800 Retained earnings, in the opening journal |
| Opening Balance (214) | 3900 Opening balance equity (the balancing line) |
| VAT collected and paid, all tax types (215001, 215002, 216001, 216002, 219 to 223) | Net balance to 2200 or 1500 in the opening journal |
| Notes payable (217) | Uncleared cheques: enter them in Finance > Cheques, unlinked |
| Supplier accounts (2211001 to 2211003, 2213) | Enter each unpaid bill under Finance > Bills with its original date |
| Prepaid or advance accounts (12041001 to 12041006) | 1700 Prepaid expenses, then a monthly journal to spread it |
| Accrued wages (218) | 2450 Accrued wages |
| Expense accounts (541 to 550, 5201 to 5206, 511 to 513) | Not carried over: opening balances start the new books at the cut-over date, so prior expenses stay in Daftra |
| Sales (411) and other income (4201) | Same: not carried over |

## 4. What we still need

Only two things: the signed **trial balance** as at the day before cut-over, and the **cut-over date** (the first of a month). Everything else is decided in this document and can be changed later in the app.
