import type { FinEntry, FinEntryKind } from "../../api/finance";

/** A cell that starts like a formula would run when the file is opened in Excel, so text like that is marked; plain numbers are left alone. */
function cell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows on screen as a CSV for Excel: UTF-8 with a byte-order mark, plain amounts with two decimals, voided rows marked. */
export function entriesCsv(entries: FinEntry[], kind: FinEntryKind): string {
  const party = kind === "Income" ? "Received from" : "Paid to";
  const lines = [["Date", "Number", party, "Category", "Account", "Reference", "Notes", "Amount (AED)", "Status", "Void reason"]];
  for (const e of entries) {
    lines.push([e.entryDate, e.entryNo, e.party, e.categoryName, e.accountName, e.reference ?? "", e.notes ?? "", e.amount.toFixed(2), e.status, e.voidReason ?? ""]);
  }
  return "﻿" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
