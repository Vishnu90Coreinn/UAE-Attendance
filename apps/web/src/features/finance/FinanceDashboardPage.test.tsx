import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinDashboard } from "../../api/finance";
import { ApiError } from "../../api/client";
import { FinanceDashboardPage } from "./FinanceDashboardPage";

vi.mock("../../api/finance");

function data(overrides: Partial<FinDashboard> = {}): FinDashboard {
  return {
    days: 30, from: "2026-10-27", to: "2026-11-25", totalBalance: 1500,
    accounts: [
      { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: "RAKBANK", accountNumber: null, iban: null, openingBalance: 1000, openingDate: "2026-08-05", isActive: true, sortOrder: 0, balance: 1150.25, entryCount: 3 },
      { id: 2, name: "Main cash", kind: "Cash", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-08-05", isActive: true, sortOrder: 1, balance: 349.75, entryCount: 1 },
    ],
    current: { income: 5000, expense: 1800.5, net: 3199.5 }, previous: { income: 2000, expense: 1500, net: 500 },
    granularity: "day", buckets: [{ start: "2026-11-24", label: "24 Nov", income: 5000, expense: 0 }, { start: "2026-11-25", label: "25 Nov", income: 0, expense: 1800.5 }],
    spending: [{ categoryId: 1, name: "Rent", amount: 1200, share: 67 }, { categoryId: 2, name: "Fuel", amount: 600.5, share: 33 }],
    latest: [{ id: 9, kind: "Income", entryNo: "INC-000009", entryDate: "2026-11-24", categoryName: "Other income", party: "One by Binghatti", accountName: "RAKBANK Current", amount: 5000 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getFinDashboard).mockResolvedValue(data());
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
  expect(screen.getByText("67%")).toBeInTheDocument();
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
