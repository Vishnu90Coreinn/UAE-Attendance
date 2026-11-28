# Finance accountant review fixes

The user approved fixes to the findings in the live accountant review. Preserve existing records and locked periods; do not invent bank allocations or reclassify historical transactions automatically.

## Implementation and verification

- [x] Reproduce misleading reconciliation checks with legacy invoice payments and manual postings. Compare the complete ledger against operational totals; expose exceptions and resolution guidance.
- [x] Return closing debit/credit balances from the trial balance, including exports. Expose its reporting date.
- [x] Require an explicit receiving account on invoice payments and handle account-load failures.
- [x] Include custody cash in the cash breakdown and label calculated bank balances as estimates.
- [x] Prevent duplicate supplier invoice references, including concurrent submissions.
- [x] Correct the standard salary-advance mapping for new setups; surface historical classification exceptions without rewriting settled books.
- [x] Improve VAT review controls, period assumptions and tax completeness guidance.
- [x] Improve reporting dates, aging navigation and the overview's cash/profit terminology.
- [x] Run regression tests, API/web builds, independent code review and a live browser re-review.

New project-costing, bank-statement ingestion, contractual retention, and a full permissions redesign are separate product capabilities. This change addresses defects and controls in the existing workflows and records those capabilities as remaining product work.


## Verified result

- `dotnet test apps/api.tests --filter 'FullyQualifiedName~Finance|FullyQualifiedName~Invoice'`: 496 passed, 0 failed.
- `npm --prefix apps/web test -- src/features/finance src/features/invoices`: 233 passed, 0 failed.
- `npm --prefix apps/web run build`: passed (TypeScript and production build).
- Independent code review found and verified fixes for cross-kind category mappings, supplier identity deduplication, API receiving-account enforcement, explicit zero VAT persistence, blank recovery values, and delayed report responses. The final React review checked state lifetimes, report races, labels, and existing component conventions.
- Live re-review: overview puts actionable items before setup; Books warns about Main cash 1,000.00 and receivables 1,896.30 differences; closing trial balance totals 997,841.09 per side; changing the date to 30 October updates it to 335,551.00 per side; receipt form requires explicit account; cash subtotal includes custody; VAT recovery controls and assigned-period configuration are present.
- API and development web server remain running at localhost:5210 and localhost:5273. Health response reports application and database OK.

## Remaining accounting decisions and product capabilities

Existing bank allocations, refundable-deposit classifications, customer-advance recognition and older salary-advance postings require documentary review. They were not silently rewritten. The actual EmaraTax period remains unconfirmed until the accountant enters it. Existing historical VAT recovery is preserved at 100 percent; this preserves the previous posting behavior and does not attest that old claims were eligible.

Separate product work remains for bank-statement import/matching and sign-off, a dedicated Accountant/Approver permission model, project profitability and retention, payroll-to-ledger reconciliation, and historical receivables/payables aging that reconstructs cancellations and removed payments at the reporting date. Staff tax classification remains part of the current submission/approval workflow; saved recovery percentages are now visible to approvers.
