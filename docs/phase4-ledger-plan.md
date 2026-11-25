# Phase 4 plan: a double-entry ledger, so the client can leave Daftra

Status: plan for review. Nothing in this document is built. It is outside the Phase 3 quotation (QTN-HR-2026-005) and needs its own quotation.

## 1. Why

The client will stop using Daftra. Daftra is where the accountant keeps the books: a chart of accounts, journals posted automatically from expenses, a trial balance, Profit & Loss, a Balance Sheet and the tax reports. Our finance module tracks money but does not keep books, so today it cannot replace Daftra.

## 2. Where we are (facts from the code)

- Money records are single-line: `FinEntry` (Expense, Income, Capital, CapitalOut), `FinTransfer`, with `FinEntryLine` splitting an entry across categories.
- An account's balance is never stored. `FinanceCalculator` works it out from opening balance, active entries and transfers. `docs/finance-test-vectors.json` pins that arithmetic, and `FinanceEndToEndScenarioTests` proves every screen agrees.
- Nothing is ever deleted. A mistake is voided, or corrected by voiding and adding a linked replacement. Locked months refuse changes.
- Pending staff expenses count nowhere until approved. Cheques are tracking only and change no balance.
- Petty cash is an account (`Custody`) per staff member, so the company total never changes when cash is handed out.

These properties are what make a ledger safe to add: every money event already has a date, an amount, a source account and a category.

## 3. Goals and non-goals

**Goals**
1. Every money event produces a balanced journal automatically, with no extra typing for staff.
2. A chart of accounts, ledger, trial balance, Profit & Loss and Balance Sheet, all taken from the journals.
3. Manual journals for the accountant, with an audit trail and period locking.
4. UAE VAT (5%) on expenses and income, with a VAT return report.
5. A clean cut-over from Daftra on an agreed date, with opening balances.

**Non-goals for this phase** (each can be quoted later): payroll journals, fixed-asset depreciation schedules, cost centres, multi-currency, corporate-tax computation, bank reconciliation against statements.

## 4. Design

### 4.1 Principle: the journal is derived, never typed twice
Staff keep entering expenses, income, transfers and capital exactly as now. Posting rules turn each into a journal. The existing records stay the source of truth for the day-to-day screens; the journal is the accountant's view of the same facts.

### 4.2 Tables (new)
- `LedgerAccount`: Id, Code, Name, Type (Asset, Liability, Equity, Revenue, Expense), ParentId, IsSystem, IsActive, and an optional link to one of: a `FinAccount`, a `FinPartner`, a `FinCategory`. Never deleted, only switched off.
- `Journal`: Id, Number (JNL-000001), Date, SourceType and SourceId (entry, transfer, opening, manual), Description, Status (Posted, Reversed), ReversesJournalId, IsManual, CreatedBy, CreatedUtc.
- `JournalLine`: JournalId, LedgerAccountId, Debit, Credit, Memo. A line has a debit or a credit, never both, never negative.
- Journals and lines are immutable. A change is a reversing journal plus a new one, the same way entries already work.

### 4.3 Posting rules

| Event | Debit | Credit |
|---|---|---|
| Expense paid from account A, category C | Expense account of C (one line per split line) | Asset account of A |
| Income received into A, category C | Asset account of A | Revenue account of C |
| Transfer from A to B (includes petty cash given or returned) | Asset account of B | Asset account of A |
| Capital put in by partner P into A | Asset account of A | Partner P's capital account |
| Capital paid back to P from A | Partner P's capital account | Asset account of A |
| Account opening balance | Asset account | Opening balance equity (split to partners' capital for their opening capital) |
| Void or correction | A reversing journal swaps debit and credit | |
| Pending staff expense | Nothing is posted until approved | |

With VAT (slice L5) an expense also debits "VAT recoverable" and an income also credits "VAT payable", using the VAT already agreed per payee or category.

### 4.4 The safety net
The ledger must agree with what we already trust. Three checks run in tests and as a report:
1. For every bank, cash and custody account, ledger balance equals `FinanceCalculator` balance.
2. Each partner's capital account equals their net capital on the Partners page.
3. Total debits equal total credits, overall and per journal.

`finance-test-vectors.json` gains ledger cases. The end-to-end scenario test also asserts the trial balance.

### 4.5 Conversion of what exists
A one-off, repeatable command rebuilds journals from existing entries and transfers (including voided ones, with their reversals) and the opening balances. Because it is derived, it can be run again after the accountant changes the mapping, in a test database first. No staff re-entry.

### 4.6 Periods and audit
Month locks apply to journals as well. Unlocking needs a reason, as now. Every manual journal records who and why.

## 5. Delivery slices

| Slice | What | Exit test |
|---|---|---|
| L1 | Chart of accounts, category and bank-account mapping screen, opening journals, auto-posting of all existing event types, conversion command | Safety checks 1 to 3 pass on the end-to-end data and on a copy of production |
| L2 | Ledger view per account with running balance, trial balance, journal list, Excel and PDF | Trial balance debits equal credits; ledger balance of each account equals its page balance |
| L3 | Manual journals with locking, reversal and audit | A balanced journal posts; an unbalanced or locked-period one is refused |
| L4 | Profit & Loss and Balance Sheet from the ledger, compared with the current period report | P&L net equals today's net result; the Balance Sheet balances |
| L5 | VAT: rates, VAT on expense and income, VAT return report, tax number handling | A known set of VAT entries reproduces the accountant's return to the fils |
| L6 | Receivables and payables: link the existing Tax Invoice module so an unpaid invoice is a receivable until paid; supplier bills | Aging report; paying an invoice clears it |
| Cut-over | Agree date and opening balances with the accountant, parallel month, sign-off, switch off Daftra | Accountant signs the first closed month from our system |

L1 to L4 give the accountant a working set of books. L5 is needed before Daftra can be dropped if the company files VAT. L6 matters once the client bills through us; Daftra currently holds no 2026 invoices.

Rough size (relative, not a quote): L1 large, L2 medium, L3 small, L4 medium, L5 large, L6 large.

## 6. Risks and how we handle them

- **A wrong mapping makes the books wrong quietly.** The accountant approves the chart and mapping before L1 goes live; the safety checks run on every build.
- **Rounding.** All money is 2 decimals; the existing largest-remainder rule stays the only place shares are worked out. Journals use the entry amounts as recorded, so there is nothing to round.
- **Parallel running.** Pick a hard cut-over date. One parallel month is enough; running both for longer invites differences nobody can explain.
- **Cheques.** Decide with the accountant whether a cheque is a liability when written or when it clears. We track cheques today and post nothing; this can change in L1 without touching the cheque screens.
- **Payroll.** Salaries are currently entered as expenses ("Monthly Salary"). Posting payroll runs directly is a later phase; until then the expense posting is correct and simple.

## 7. Questions for the client's accountant

1. Please send the current Daftra chart of accounts. Do we keep its codes and names?
2. For each expense and income category, which account should it post to?
3. How are the partners' capital accounts kept: one account per partner, or one combined?
4. Is the company VAT-registered, and when does the first return fall after the cut-over? Is any expense VAT-exempt or outside scope?
5. Cheques: liability when written, or when cleared?
6. Which financial year end and which reporting currency?
7. What opening balances will the books start from, and as of which date? Who signs them?
8. Which reports does the accountant use every month, so those are built first?
9. Will the accountant post manual journals in our system or send them to us?
10. Is UAE Corporate Tax or e-invoicing planned for the next twelve months?

## 8. What we need to start

The answers to section 7, the Daftra chart of accounts export, an agreed cut-over date, and a decision on VAT scope. With those, L1 can begin and the quotation can be sized properly.
