import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { PayablesTab } from "./PayablesTab";

vi.mock("../../api/finance");

const report: financeApi.PayablesReport = {
  asOf: "2026-11-25", totalOwed: 1575,
  buckets: [{ name: "Not yet due", count: 0, amount: 0 }, { name: "1 to 30 days", count: 0, amount: 0 }, { name: "31 to 60 days", count: 1, amount: 1575 }, { name: "61 to 90 days", count: 0, amount: 0 }, { name: "Over 90 days", count: 0, amount: 0 }],
  rows: [{ billId: 1, billNo: "BILL-000001", supplier: "Gulf Aluminium Supplies", supplierRef: "SUP-77", billDate: "2026-09-26", dueDate: "2026-10-16", total: 1575, paid: 0, balance: 1575, daysOverdue: 40, bucket: "31 to 60 days" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getPayables).mockResolvedValue(report);
});

it("lists unpaid bills with how late each is, and the total owed to suppliers", async () => {
  render(<PayablesTab />);

  expect(await screen.findByText("BILL-000001")).toBeInTheDocument();
  expect(screen.getByText("40 days late")).toBeInTheDocument();
  expect(screen.getByText("AED 1,575.00")).toBeInTheDocument();
});

it("says so when nothing is owed", async () => {
  vi.mocked(financeApi.getPayables).mockResolvedValue({ ...report, rows: [], totalOwed: 0 });
  render(<PayablesTab />);

  expect(await screen.findByText("No unpaid bills.")).toBeInTheDocument();
});
