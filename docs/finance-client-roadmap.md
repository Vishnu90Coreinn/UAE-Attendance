# Finance roadmap: what comes next

Prepared for DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C

## Why this document

You are using Daftra and the new app side by side, and will move fully to the new app once the figures are right. We went through your Daftra account to see what you actually use every day. This roadmap lists seven things Daftra does for you that the new app does not do yet, in the order we suggest building them.

The sizes are rough estimates (Small: a few days, Medium: about a week or two, Large: several weeks). Anything beyond the current quotation will be quoted separately before work starts.

## What you use in Daftra today

- **Expenses.** About 274 entries since August, each with a category, a note, a receipt photo and the bank or supplier reference as its number.
- **Bank and cash.** One RAKBANK account and one cash account.
- **Payable cheques.** Four cheques so far, including two post-dated ones due in January and May 2027.
- **A list of people you pay.** Your landlord, the insurer, the labour agent and some individuals, kept as "clients".
- **Staff entering their own expenses.** A staff member records expenses from their own login.
- **Staff, contracts and attendance**, with early-leave deductions calculated each day.

Sales invoices, estimates, projects, tasks, loans, assets and cost centres are switched on in Daftra but empty. We are not planning any of those.

## Where each item stands

| # | Item | Status |
|---|---|---|
| 1 | Cheque register | Built and tested |
| 2 | Staff expense entry, "Entered by", approval | Built and tested |
| 3 | Split one expense across categories | Built and tested |
| 4 | List of payees | Built and tested |
| 5 | More reports (by payee, by who entered, cash flow, day/week/year) | Built and tested |
| 6 | Receipt scanner and Excel import | Excel import built and tested. Receipt scanner left out for now: it needs an outside service, so it waits for a decision |
| 7 | Staff petty cash | Built and tested |

## The seven items

### 1. Cheque register (Medium)
**What you do now:** Daftra records each cheque with its number, payee, issue date, due date and status (issued, delivered).
**What we will build:** A cheque list showing issued, delivered, cleared and bounced cheques. An "upcoming cheques" view so post-dated cheques show as money you have already committed. Each cheque links to its expense, for example the rent cheque and the rent expense.
**Why it matters:** Two cheques of AED 10,000 are due in 2027. Your bank balance looks higher than it really is until they clear.
**We need from you:** The cheque statuses you use, and whether you also receive cheques from customers.

### 2. Staff can enter expenses, with a clear "Entered by" (Medium)
**What you do now:** A staff member adds expenses from their own login, and Daftra can report expenses by who entered them.
**What we will build:** A limited role that can add expenses and see only their own. Every entry shows who entered it. An optional approval step where a manager confirms before it counts in the figures.
**Why it matters:** Whoever pays on site can record it straight away, and you can see who recorded what.
**We need from you:** Who should be allowed to enter, and whether you want approval before entries count.

### 3. Split one expense across categories (Small)
**What you do now:** One payment holds several items. For example, a payment of AED 5,000 was a 2,000 security deposit plus 3,000 agency commission, explained only in the note.
**What we will build:** Split one payment into lines, each with its own category and amount, which must add up to the total.
**Why it matters:** Reports by category become correct without keeping separate entries.

### 4. List of payees (Small)
**What you do now:** The people you pay are saved in Daftra, so you do not retype them.
**What we will build:** A payee list. Pick a payee when adding an expense and its usual category is filled in. Reports can then show how much you paid each payee.
**Why it matters:** Total paid to your landlord or insurer in one click, with names spelled the same way every time.

### 5. More reports (Medium)
**What you do now:** Daftra reports expenses and income by category, payee and who entered them, by day, week, month and year. It also has a cash flow report, income statement and tax report.
**What we will build:** Expenses and income by payee and by who entered them, plus daily, weekly and yearly views, and a cash flow report. All can be downloaded as Excel and PDF.
**Why it matters:** The questions you ask your accountant can be answered on screen.
**We need from you:** Which of Daftra's reports you open most, so we build those first. We do not plan a full balance sheet or trial balance unless your accountant needs them.

### 6. Receipt scanner and Excel import (Large)
**What you do now:** The AI Upload button reads a receipt photo into an expense. You can also import many expenses from a file.
**What we will build:** Upload a receipt photo and have the date, amount and payee suggested for you to check and save. Import expenses from an Excel file with a preview before anything is saved.
**Why it matters:** Less typing and fewer mistakes when many receipts arrive together.
**We need from you:** A few sample receipts and the Excel layout you would import.

### 7. Staff petty cash (Large)
**What you do now:** Daftra has employee custody (cash given to a staff member to spend) and settlement types, but it is not in use yet.
**What we will build:** Record cash given to a staff member, the expenses they enter against it and what is returned, so you always see who holds how much.
**Why it matters:** It becomes useful once item 2 lets staff enter their own expenses.
**We need from you:** Whether you plan to give staff cash advances.

## Suggested order

| Order | Item | Size | Depends on |
|---|---|---|---|
| 1 | Cheque register | Medium | none |
| 2 | Staff expense entry and "Entered by" | Medium | none |
| 3 | Split an expense | Small | none |
| 4 | List of payees | Small | none |
| 5 | More reports | Medium | items 2 and 4 make them richer |
| 6 | Receipt scanner and Excel import | Large | none |
| 7 | Staff petty cash | Large | item 2 |

Items 3 and 4 are quick and could ship together with item 1.

## Before you switch fully

These are already planned and are separate from this list:
- Opening balances for the bank and cash accounts.
- Each partner's opening capital.
- The date you stop entering in Daftra and start only in the new app.

## Please tell us

1. Which items matter most to you, and any you want removed.
2. Whether staff should enter expenses (item 2), and if so who.
3. Which Daftra reports you really use (item 5).
4. Whether you receive cheques as well as issue them (item 1).
