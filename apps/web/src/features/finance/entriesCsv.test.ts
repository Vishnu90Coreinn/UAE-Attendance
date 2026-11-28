import { expect, it } from "vitest";
import type { FinEntry } from "../../api/finance";
import { entriesCsv } from "./entriesCsv";

const entry = (overrides: Partial<FinEntry> = {}): FinEntry => ({
  id: 1, kind: "Expense", entryNo: "EXP-000001", entryDate: "2026-11-20", categoryId: 1, categoryName: "Company expenses", party: "Ace Hardware", accountId: 1, accountName: "RAKBANK",
  amount: 1250.5, reference: "INV 7", notes: 'Drill bits, "heavy duty"', status: "Active", voidReason: null, createdBy: "m", createdUtc: "2026-11-20T08:00:00Z", attachments: [],
  voidedBy: null, voidedUtc: null, replacesEntryId: null, replacesEntryNo: null, replacedByEntryNo: null, ...overrides,
});

it("writes a BOM, a header row, plain two-decimal amounts and quotes commas and quotes", () => {
  const csv = entriesCsv([entry()], "Expense");
  expect(csv.startsWith("﻿")).toBe(true);
  const [header, row] = csv.slice(1).split("\r\n");
  expect(header).toBe("Date,Number,Paid to,Category,Account,Reference,Notes,Amount (AED),Status,Void reason");
  expect(row).toBe('2026-11-20,EXP-000001,Ace Hardware,Company expenses,RAKBANK,INV 7,"Drill bits, ""heavy duty""",1250.50,Active,');
});

it("calls the party column Received from for income and marks voided rows with their reason", () => {
  const csv = entriesCsv([entry({ kind: "Income", status: "Voided", voidReason: "Entered twice" })], "Income");
  expect(csv).toContain("Received from");
  expect(csv).toContain("Voided,Entered twice");
});

it("marks text that looks like a formula, but leaves negative numbers alone", () => {
  const csv = entriesCsv([entry({ party: "=SUM(A1)", reference: "-250.00" })], "Expense");
  expect(csv).toContain("'=SUM(A1)");
  expect(csv).toContain(",-250.00,");
});
