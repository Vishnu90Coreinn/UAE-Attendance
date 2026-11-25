# Staff Attendance (Office Employees): Questions for Client

Context: the client wants to record attendance for office employees, some of whom work from home (WFH). Office employees are managed separately from site workers.

Priority questions if a short list is needed: 5, 6, 16, 21, 22, 23, 24, 34.

## 1. Who and how
1. How many office employees will use this, and how many of them work from home (WFH)? No WFH , only office users.
2. Should each employee log in with their own account on their phone or laptop? Or will there be one shared device at the office entrance? employee log in with their own account on their phone or laptop
3. Who manages employee records (add, edit, deactivate)? HR only, or managers too? HR and Manager as same as worker
4. Who reviews attendance? Direct manager, HR, or both? both

## 2. Working hours
5. Standard shift timing? Is it 9:00 AM to 5:00 PM for everyone, or do departments or people have different shifts? 9:00 AM to 5:00
6. Weekly off days? Friday only (as in your sample), or Friday and Saturday, or Saturday and Sunday? Sunday only
7. Grace period before someone is marked "Late" (for example 10 or 15 minutes)? 15 min
8. What counts as "Early Leave"? Any time before the shift end?15 mins
9. Is overtime applicable to office staff? If yes, how is it calculated? No
10. Public holidays: should the system hold a holiday list so those days are not marked Absent? Yes
11. Break time: is a lunch break deducted from worked hours? No

## 3. Sign-in / Sign-out
12. One sign-in and one sign-out per day, or multiple (for example, going out for a meeting and returning)? Multiple possible
13. What if an employee forgets to sign out? Auto sign-out at shift end, or flag it for the manager to correct? flag to manager / by default mark as leave
14. Can a manager or HR correct or add attendance manually? If so, should the change be recorded with a reason? Yes
15. Can employees sign in from any device, or only a registered one? Any device

## 4. Work From Home - Not Applicable
16. Does WFH need approval before the day? If yes, who approves? 
17. Is there a limit (for example, 2 WFH days per week or per month)?
18. When working from home, should the employee still sign in and out? With selfie and location, or only a button press?
19. Should WFH be shown as its own status in reports (separate from Present)?
20. Any difference in pay or entitlement for WFH days?

## 5. Verification (photo and location)
21. Is a selfie mandatory at every sign-in and sign-out? Or only sometimes? Every SignIn and SignOUt
22. Is GPS location mandatory? For office days only, WFH days only, or both? For office days only
23. Should the system verify that the employee is physically at the office (a geofence)? If yes, please share the office address or coordinates and the allowed radius. Will provide later
24. If an employee signs in from outside the office without an approved WFH, should the system block it or accept it and flag it for the manager? Flag it to manager
25. How long should photos and location data be kept (30 days, 90 days, 1 year)? 1yr
26. Do employees need to be informed or consent to photo and location capture? (Needed for UAE data-protection compliance.) No

## 6. Leave
27. Should leave (annual, sick, emergency, others) be recorded in this module? Should employees apply for leave in the system, or should HR just mark it? Employee should apply for leave
28. Leave balances: does the system need to track them, or only mark the day as "On Leave"? Need to track them

## 7. Reports and output
29. Which reports are needed? Daily, weekly, monthly, per employee, per department? All
30. Preferred format? Excel like your sample, PDF, or both? Please share any additional columns you want (sign-in time, sign-out time, late minutes, location, work mode). Both
31. Should reports show total late minutes, early-leave minutes, and total hours per employee? Yes
32. Should the dashboard show live numbers (signed in today, late, on WFH, absent)? Yes
33. Who should be able to see reports? HR, managers, partners? HR,Manager,Partner

## 8. Payroll and integration
34. Is this for attendance tracking only, or should it feed salary deductions (for late arrival or absence)? Attendance  tracking only
35. Is there an existing employee list or HR system to import from (Excel is fine)? Yes

## 9. Other
36. Should employees receive reminders (for example, "you haven't signed in")? No
37. Language: English only, or Arabic as well? English
38. Anything in the prototype you want changed, removed, or added? No

---

# Finance, Accounting and Expense Management: Questions for Client

Context: the client shared a Finance and Expense ERP prototype (dashboard with bank liquidity, bank accounts and transactions, expenses with UAE VAT and receipts, chart of accounts, general ledger, trial balance).

Priority questions if a short list is needed: F1, F2, F4, F8, F10.

## A. Scope
F1. Is this meant to replace your current accounting software (for example Tally, Zoho Books, QuickBooks), or only track expenses and bank balances and then hand over to your accountant? Only tracking
F2. Do you need full double-entry accounting (journal entries, general ledger, trial balance), or is expense and bank tracking enough for now? Ehis is enough
F3. Is this for one company or multiple companies? Is a single currency (AED) enough, or are foreign-currency payments needed? One company

## B. Bank accounts and transactions
F4. How many bank accounts and cash or petty-cash accounts do you have? Do you need to import bank statements and reconcile them? NO
F5. Should transfers between your own accounts be recorded? YEs
F6. Who can add bank accounts and post bank transactions? Should IBAN and account numbers be visible to everyone or only to selected roles? Only to Selected Roles

## C. Expenses and VAT
F7. What are your expense categories (the sample shows Software, Office Supplies, Travel, Utilities and Rent, Marketing, Professional Services)? Please share the full list you actually use. Let them add manually or option to add new item as per needed
F8. VAT: is the company VAT-registered? Please share the TRN, the filing period (monthly or quarterly), and whether you need a VAT return report (input VAT and output VAT). No
F9. Are some expenses VAT-exempt or zero-rated? Is input VAT always recoverable?  No
F10. Who approves expenses? Are there approval limits by amount? Should employees submit expenses and managers approve?
F11. Should the receipt or supplier invoice upload be mandatory? How long must receipts be kept? Yes
F12. Do you need a supplier (vendor) list with TRN, payment terms, and outstanding payables? NO
F13. Are expenses linked to a project, site, or client (so profit per project can be seen)? No

## D. Accounting and ledger
F14. Please share your current chart of accounts (account codes and names), or confirm we can start from a standard UAE template. Standard is fine
F15. Should invoices raised in this system (receivables, revenue, output VAT) post automatically to the ledger? No
F16. Should worker and employee salaries post to the ledger? Should payroll and WPS payments be included? No
F17. How should corrections work? Editing and deleting entries, or reversing entries with an audit trail? Do you need month-end period locking? Yes
F18. What financial statements do you need (trial balance, profit and loss, balance sheet, cash flow)? Do you need opening-balance import from your current system? Yes

## E. Users and access
F19. Who uses this (CFO, accountant, managers, partners)? Which roles can create, approve, view only, and export? Manager and Admin
F20. Should partners (view-only users) see the finance data? Yes

## F. Reports and dashboard
F21. Which dashboard numbers matter most (bank liquidity, 7/30/365-day spend, payables, receivables, VAT payable)? All
F22. Preferred export formats (CSV, Excel, PDF)? Any report layout you must follow? All

## G. Rollout
F23. Is there existing data to import (bank balances, expenses, vendors, chart of accounts)? In what format? No
F24. Which should come first: staff attendance or finance? Is there a target date? Staff attendance then Finance. in 2 weeks

