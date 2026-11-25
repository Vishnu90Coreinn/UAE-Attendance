import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinEntry } from "../../api/finance";
import { MyExpensesPage } from "./MyExpensesPage";

vi.mock("../../api/finance");

const custody: FinAccount = { id: 7, name: "Jesus petty cash", kind: "Custody", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 550, entryCount: 0, holderName: "jesus" };
const mine = (over: Partial<FinEntry>): FinEntry => ({
  id: 1, kind: "Expense", entryNo: "EXP-000348", entryDate: "2026-11-24", categoryId: 1, categoryName: "Company expenses", party: "du", accountId: 7, accountName: "Jesus petty cash", amount: 50,
  reference: null, notes: null, status: "Pending", voidReason: null, createdBy: "jesus", createdUtc: "2026-11-24T08:00:00Z", attachments: [], voidedBy: null, voidedUtc: null, replacesEntryId: null,
  replacesEntryNo: null, replacedByEntryNo: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getFinMyOptions).mockResolvedValue({ accounts: [custody], categories: [], payees: [] });
  vi.mocked(financeApi.listMyFinExpenses).mockResolvedValue({
    items: [mine({}), mine({ id: 2, entryNo: "EXP-000349", party: "Pharmacy", amount: 75, status: "Voided", voidReason: "Rejected: Personal purchase" }), mine({ id: 3, entryNo: "EXP-000350", party: "Stationery", status: "Active" })],
    total: 50, count: 2, truncated: false, pendingCount: 1, pendingTotal: 50,
  });
});

it("shows each expense with whether it was approved, and why one was rejected", async () => {
  render(<MyExpensesPage />);

  expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
  expect(screen.getByText("Approved")).toBeInTheDocument();
  expect(screen.getByText("Rejected")).toBeInTheDocument();
  expect(screen.getByText("Rejected: Personal purchase")).toBeInTheDocument();
});

it("shows the cash the person holds, and nothing else about the company's money", async () => {
  render(<MyExpensesPage />);

  expect(await screen.findByText("Cash you hold")).toBeInTheDocument();
  expect(screen.getByText("550.00")).toBeInTheDocument();
  expect(screen.queryByText(/RAKBANK/)).not.toBeInTheDocument();
});

it("tells staff when no account has been set up for them to pay from", async () => {
  vi.mocked(financeApi.getFinMyOptions).mockResolvedValue({ accounts: [], categories: [], payees: [] });
  render(<MyExpensesPage />);

  expect(await screen.findByText(/No account has been set up for you/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
});
