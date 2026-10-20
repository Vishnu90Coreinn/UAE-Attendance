# S4 Monthly payroll, print and PDF

Date: 2026-10-20. Branch: `slice/s4-payroll`, based on S3 `7f258fc`.

Implementation commits: `5f52163` (API/calculator/PDF) and `099ef66` (web report/print/export), followed by the documentation commit containing this report.

The owner requested a free PDF alternative and confirmed that the English prototype is the required scope. PdfPig 0.1.16 (Apache 2.0), with embedded Noto Sans fonts (SIL OFL), replaces QuestPDF. No browser runtime or paid PDF service is required. See [third-party notices](../../THIRD-PARTY-NOTICES.md).

## Delivered

- Monthly draft payroll JSON and selectable-text A4 PDF, available to all signed-in roles, with explicit anonymous guards.
- Monthly and grand totals sum rounded daily components through the shared calculator. Active workers without attendance and inactive workers with historical records are included.
- Coherent SQL reads use a serializable transaction and the attendance write lock order. Strict month validation covers the complete DateOnly range, including December 9999.
- A deterministic report revision prevents downloading changed data against the displayed report. A stale export returns 409 and requires reload.
- The six prototype columns retain **Total Net Salary**, company settings, signatures and TOTAL PAYROLL. PDF headers repeat on subsequent pages, with page numbers and word-aware wrapping.
- React renders server figures, supports month selection, loading/retry/empty states, print styles and authenticated PDF download. Settings changes update shell branding immediately.
- Unsupported PDF glyphs receive a controlled 422 response with a Print fallback. Arabic/complex-script PDF reporting is outside the owner-confirmed scope; worker storage remains unrestricted.
- No database schema changes. Finalisation and frozen rate snapshots remain S5.

## Verification

- API build: zero warnings and errors. Sequential full suite with `xUnit.MaxParallelThreads=2`: **505 passed**, none failed or skipped.
- Web suite with `--maxWorkers=2`: **307 passed** across 24 files; lint, TypeScript and production build pass.
- Independent specification and quality reviews completed; wording, filename, layout and unsupported-glyph findings resolved.
- Removed both anonymous guards temporarily: the two authorization tests failed, then guards were restored. Read-committed mutation failed the coherence test; serializable isolation was restored.
- Real browser: Administrator and Viewer access, month switch, successful download, stale-export feedback and reload recovery. Desktop and 375px layouts inspected; no page overflow at 375px.
- September fixture totals match JSON, screen and PDF: basic AED 2,362.76, overtime AED 23.32, total AED 2,386.08. Includes daily component rounding and inactive historical workers.
- One-page and four-page PDFs rendered with Poppler; every page visually inspected. Long worker names/designations wrap without overlap, repeated headers and page numbering remain readable, totals occur once. PDF text is extractable and page size is A4 portrait.
- Native browser print preview could not be inspected through the available browser control: invoking Print blocked the click command. The print handler is covered by tests and the shared report/print CSS is reviewed; physical printer output remains a manual check.
- A concurrent API/web verification run produced SQL connection timeouts and one frontend wait timeout. Both suites passed when repeated sequentially with bounded concurrency, without implementation changes.
- Verification servers stopped and disposable LocalDB databases removed; no `HrPayroll%` databases remained. Whitespace checks pass for source and docs; the upstream PdfPig licence retains its original whitespace.

## Handover

The owner authorized pushing these changes. Push the S4 branch without merging or rewriting history. S3 commits are ancestors of this branch. Stop at the S4 review checkpoint; S5 is next.
