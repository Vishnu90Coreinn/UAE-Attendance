import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinDashboard } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { FinanceDashboardPage } from "./FinanceDashboardPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../utils/useIsDesktop", () => ({ useIsDesktop: () => true }));

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

function data(overrides: Partial<FinDashboard> = {}): FinDashboard {
  return {
    days: 30, from: "2026-10-27", to: "2026-11-25", totalBalance: 1500,
    accounts: [
      { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: "RAKBANK", accountNumber: null, iban: null, openingBalance: 1000, openingDate: "2026-08-05", isActive: true, sortOrder: 0, balance: 1150.25, entryCount: 3 },
      { id: 2, name: "Main cash", kind: "Cash", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-08-05", isActive: true, sortOrder: 1, balance: 349.75, entryCount: 1 },
    ],
    current: { income: 5000, expense: 1800.5, net: 3199.5 }, previous: { income: 2000, expense: 1500, net: 500 },
    granularity: "day", buckets: [{ start: "2026-11-24", label: "24 Nov", income: 5000, expense: 0 }, { start: "2026-11-25", label: "25 Nov", income: 0, expense: 1800.5 }],
    spending: [{ categoryId: 1, name: "Rent", amount: 1200, share: 66.6 }, { categoryId: 2, name: "Fuel", amount: 600.5, share: 33.4 }],
    latest: [{ id: 9, kind: "Income", entryNo: "INC-000009", entryDate: "2026-11-24", categoryName: "Other income", party: "One by Binghatti", accountName: "RAKBANK Current", amount: 5000 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.getFinDashboard).mockResolvedValue(data());
  vi.mocked(financeApi.listFinCategories).mockResolvedValue([
    { id: 1, kind: "Expense", name: "Rent", isActive: true, useCount: 1 },
    { id: 10, kind: "Income", name: "Other income", isActive: true, useCount: 1 },
  ]);
});

const view = () => render(<MemoryRouter><FinanceDashboardPage /></MemoryRouter>);

it("leads with the period's net result and compares it with the days before", async () => {
  view();
  const panel = await screen.findByRole("region", { name: /net result/i });
  expect(within(panel).getByText("3,199.50")).toBeInTheDocument();
  expect(within(panel).getByText(/AED 2,699\.50 better than the 30 days before/)).toBeInTheDocument();
  expect(financeApi.getFinDashboard).toHaveBeenCalledWith(30);
});

it("shows balances, spending by category with shares, and the latest entries with a sign", async () => {
  view();
  await screen.findByText("Where the money went");
  expect(screen.getByText("RAKBANK Current")).toBeInTheDocument();
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("66.6%")).toBeInTheDocument();
  expect(screen.getByText("33.4%")).toBeInTheDocument();
  const row = screen.getByText("One by Binghatti").closest("li")!;
  expect(within(row).getByText("Income")).toBeInTheDocument();
  expect(within(row).getByText("+")).toBeInTheDocument();
});

it("reloads for the period that is picked", async () => {
  view();
  await screen.findByText("Where the money went");
  await userEvent.click(screen.getByRole("radio", { name: "7 days" }));
  await waitFor(() => expect(financeApi.getFinDashboard).toHaveBeenLastCalledWith(7));
  expect(screen.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "true");
});

it("says so when nothing is there to compare, and when nothing was recorded", async () => {
  vi.mocked(financeApi.getFinDashboard).mockResolvedValue(
    data({ current: { income: 0, expense: 0, net: 0 }, previous: { income: 0, expense: 0, net: 0 }, spending: [], latest: [], accounts: [], totalBalance: 0, buckets: [{ start: "2026-11-25", label: "25 Nov", income: 0, expense: 0 }] }),
  );
  view();
  expect(await screen.findByText(/nothing to compare with/i)).toBeInTheDocument();
  expect(screen.getByText("No expenses in this period")).toBeInTheDocument();
  expect(screen.getByText("Nothing recorded yet")).toBeInTheDocument();
  expect(screen.getByText("No accounts yet")).toBeInTheDocument();
});

it("shows a negative net with a minus sign and offers a retry when loading fails", async () => {
  vi.mocked(financeApi.getFinDashboard).mockResolvedValueOnce(data({ current: { income: 0, expense: 100, net: -100 } }));
  const { unmount } = view();
  const panel = await screen.findByRole("region", { name: /net result/i });
  expect(within(panel).getByLabelText("minus")).toBeInTheDocument();
  unmount();

  vi.mocked(financeApi.getFinDashboard).mockRejectedValueOnce(new ApiError(500, "Server error"));
  view();
  expect(await screen.findByText(/server error/i)).toBeInTheDocument();
});

it("says how income and expenses compare with the days before, in words", async () => {
  view();
  const panel = await screen.findByRole("region", { name: /net result/i });
  expect(within(panel).getByText(/Before: AED 2,000.00/)).toBeInTheDocument();
  expect(within(panel).getByText("up 150.0%")).toBeInTheDocument(); // income 5,000 against 2,000
  expect(within(panel).getByText("up 20.0%")).toBeInTheDocument(); // expenses 1,800.50 against 1,500
});

it("lets a Manager add an expense or income from the overview, and refreshes afterwards", async () => {
  vi.mocked(financeApi.createFinEntry).mockResolvedValue({
    id: 5, kind: "Income", entryNo: "INC-000005", entryDate: "2026-11-25", categoryId: 10, categoryName: "Other income", party: "Client", accountId: 1, accountName: "RAKBANK Current",
    amount: 750, reference: null, notes: null, status: "Active", voidReason: null, createdBy: "m", createdUtc: "2026-11-25T08:00:00Z", attachments: [],
    voidedBy: null, voidedUtc: null, replacesEntryId: null, replacesEntryNo: null, replacedByEntryNo: null,
  });
  vi.mocked(financeApi.listFinParties).mockResolvedValue([]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue([]);
  view();
  await userEvent.click(await screen.findByRole("button", { name: "Add income" }));
  await userEvent.type(screen.getByLabelText("Amount (AED)"), "750");
  await userEvent.selectOptions(screen.getByLabelText("Category"), "10");
  await userEvent.selectOptions(screen.getByLabelText("Received into"), "1");
  await userEvent.type(screen.getByLabelText("Received from"), "Client");
  await userEvent.click(screen.getByRole("button", { name: "Save income" }));
  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalledWith("Income", expect.objectContaining({ amount: 750, accountId: 1, categoryId: 10 })));
  expect(await screen.findByText(/INC-000005/)).toBeInTheDocument();
  expect(vi.mocked(financeApi.getFinDashboard).mock.calls.length).toBeGreaterThan(1);
});

it("gives a Partner (Viewer) no buttons that add anything", async () => {
  signIn("Viewer");
  view();
  await screen.findByRole("region", { name: /net result/i });
  expect(screen.queryByRole("button", { name: /add (income|expense)/i })).not.toBeInTheDocument();
  expect(financeApi.listFinCategories).not.toHaveBeenCalled();
});

it("explains the balances: the money in the accounts today, the partners' capital with exact shares, and capital in the latest list", async () => {
  vi.mocked(financeApi.getFinDashboard).mockResolvedValue(
    data({
      capital: { total: 270000.5, partners: [{ id: 1, name: "Partner A", netCapital: 145000, share: 53.7 }, { id: 2, name: "Partner B", netCapital: 125000.5, share: 46.3 }] },
      latest: [
        { id: 9, kind: "Capital", entryNo: "CAP-000001", entryDate: "2026-11-24", categoryName: "Capital contribution", party: "Partner A", accountName: "RAKBANK Current", amount: 25000 },
        { id: 8, kind: "CapitalOut", entryNo: "RTN-000001", entryDate: "2026-11-23", categoryName: "Capital returned", party: "Partner B", accountName: "RAKBANK Current", amount: 5000 },
      ],
    }),
  );
  view();
  const panel = await screen.findByRole("region", { name: /net result/i });
  expect(within(panel).getByText(/In the accounts today/)).toHaveTextContent("AED 1,500.00");
  expect(screen.getByText("Partners' capital")).toBeInTheDocument();
  expect(screen.getByText("53.7%")).toBeInTheDocument();
  expect(screen.getByText("46.3%")).toBeInTheDocument();
  expect(screen.getByText("270,000.50")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Partner A 53.7%, Partner B 46.3%/ })).toBeInTheDocument();
  const added = screen.getByText("CAP-000001").closest("li")!;
  expect(within(added).getByText("Capital added")).toBeInTheDocument();
  expect(within(added).getByText("+")).toBeInTheDocument();
  const returned = screen.getByText("RTN-000001").closest("li")!;
  expect(within(returned).getByText("−")).toBeInTheDocument();
});

it("shows no capital card when no partner holds capital", async () => {
  view();
  await screen.findByRole("region", { name: /net result/i });
  expect(screen.queryByText("Partners' capital")).not.toBeInTheDocument();
});

