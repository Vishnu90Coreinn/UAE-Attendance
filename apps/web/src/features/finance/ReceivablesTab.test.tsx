import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { ReceivablesTab } from "./ReceivablesTab";

vi.mock("../../api/finance");

const report: financeApi.ReceivablesReport = {
  asOf: "2026-11-25", totalOwed: 1700, unrecordedPayments: 0,
  buckets: [{ name: "Not yet due", count: 1, amount: 650 }, { name: "1 to 30 days", count: 0, amount: 0 }, { name: "31 to 60 days", count: 1, amount: 1050 }, { name: "61 to 90 days", count: 0, amount: 0 }, { name: "Over 90 days", count: 0, amount: 0 }],
  rows: [
    { invoiceId: 1, number: "INV-000190", client: "Acme Glass LLC", invoiceDate: "2026-09-26", dueDate: "2026-10-16", total: 1050, paid: 0, balance: 1050, daysOverdue: 40, bucket: "31 to 60 days" },
    { invoiceId: 2, number: "INV-000191", client: "Zed Builders", invoiceDate: "2026-11-20", dueDate: "2026-12-20", total: 1050, paid: 400, balance: 650, daysOverdue: 0, bucket: "Not yet due" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getReceivables).mockResolvedValue(report);
});

it("lists unpaid invoices with how late each is, and the total owed", async () => {
  render(<ReceivablesTab />);

  expect(await screen.findByText("INV-000190")).toBeInTheDocument();
  expect(screen.getByText("40 days late")).toBeInTheDocument();
  expect(screen.getByText("AED 1,700.00")).toBeInTheDocument();
  expect(screen.queryByText(/never added to a bank/)).not.toBeInTheDocument();
});

it("warns about payments that never reached a bank or cash account", async () => {
  vi.mocked(financeApi.getReceivables).mockResolvedValue({ ...report, unrecordedPayments: 2 });
  render(<ReceivablesTab />);

  expect(await screen.findByText(/2 payments were entered before invoices were tied to the books/)).toBeInTheDocument();
});

it("says so when nothing is owed", async () => {
  vi.mocked(financeApi.getReceivables).mockResolvedValue({ ...report, rows: [], totalOwed: 0, buckets: report.buckets.map((b) => ({ ...b, count: 0, amount: 0 })) });
  render(<ReceivablesTab />);

  expect(await screen.findByText("No unpaid invoices.")).toBeInTheDocument();
});
