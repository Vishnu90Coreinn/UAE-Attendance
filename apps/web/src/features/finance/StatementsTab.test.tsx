import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { StatementsTab } from "./StatementsTab";

vi.mock("../../api/finance");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getProfitAndLoss).mockResolvedValue({
    from: "2026-11-01", to: "2026-11-25", totalRevenue: 30000, totalExpenses: 12600, netProfit: 17400, manualJournals: 1,
    revenue: [{ code: "4000", name: "Other income", amount: 30000 }],
    expenses: [{ code: "5040", name: "Worker Accommodation Rent", amount: 12000 }, { code: "5070", name: "Dubai Insurance", amount: 600 }],
  });
  vi.mocked(financeApi.getBalanceSheet).mockResolvedValue({
    asOf: "2026-11-25", totalAssets: 45150, totalLiabilities: 0, totalEquity: 45150, totalLiabilitiesAndEquity: 45150, retainedProfit: 17150, balanced: true,
    assets: [{ code: "1100", name: "RAKBANK Current", amount: 45150 }], liabilities: [], equity: [{ code: "3100", name: "Capital: Partner A", amount: 28000 }],
  });
});

it("shows revenue, expenses and the net profit, and says when journals posted by hand are included", async () => {
  render(<StatementsTab which="pl" />);

  expect(await screen.findByText("Worker Accommodation Rent")).toBeInTheDocument();
  expect(screen.getByText("Net profit")).toBeInTheDocument();
  expect(screen.getAllByText("AED 17,400.00").length).toBeGreaterThan(0);
  expect(screen.getByText(/Includes 1 journal posted by hand/)).toBeInTheDocument();
  expect(financeApi.getProfitAndLoss).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-01$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
});

it("calls a negative result a net loss", async () => {
  vi.mocked(financeApi.getProfitAndLoss).mockResolvedValue({ from: "2026-11-01", to: "2026-11-25", totalRevenue: 0, totalExpenses: 500, netProfit: -500, manualJournals: 0, revenue: [], expenses: [{ code: "5000", name: "Company expenses", amount: 500 }] });
  render(<StatementsTab which="pl" />);

  expect(await screen.findByText("Net loss")).toBeInTheDocument();
  expect(screen.getByText("Nothing in this period.")).toBeInTheDocument();
});

it("shows a balance sheet that balances, with the profit retained inside equity", async () => {
  render(<StatementsTab which="sheet" />);

  expect(await screen.findByText("Total assets")).toBeInTheDocument();
  expect(screen.getByText("Profit retained to date")).toBeInTheDocument();
  expect(screen.getByText(/Assets equal liabilities plus equity/)).toBeInTheDocument();
  expect(screen.getAllByText("AED 45,150.00").length).toBeGreaterThanOrEqual(3);
});

it("says plainly when the sheet does not balance", async () => {
  vi.mocked(financeApi.getBalanceSheet).mockResolvedValue({ asOf: "2026-11-25", totalAssets: 100, totalLiabilities: 0, totalEquity: 90, totalLiabilitiesAndEquity: 90, retainedProfit: 0, balanced: false, assets: [], liabilities: [], equity: [] });
  render(<StatementsTab which="sheet" />);

  expect(await screen.findByText(/The books need attention/)).toBeInTheDocument();
});
