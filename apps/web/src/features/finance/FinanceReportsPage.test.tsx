import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinReport } from "../../api/finance";
import { ApiError } from "../../api/client";
import { FinanceReportsPage } from "./FinanceReportsPage";
import * as download from "../payroll/downloadPdf";

vi.mock("../../api/finance");
vi.mock("../payroll/downloadPdf", () => ({ saveBlob: vi.fn() }));
vi.mock("../../utils/useIsDesktop", () => ({ useIsDesktop: () => true }));
vi.mock("./financeFormat", async (importOriginal) => ({ ...(await importOriginal<typeof import("./financeFormat")>()), todayInUae: () => "2026-11-25" }));

function report(overrides: Partial<FinReport> = {}): FinReport {
  return {
    from: "2026-11-01", to: "2026-11-25",
    accounts: [
      { accountId: 1, name: "RAKBANK Current", kind: "Bank", isActive: true, opening: 1500, income: 300, expense: 200, transfersIn: 0, transfersOut: 100, capital: 0, closing: 1500 },
      { accountId: 2, name: "Main cash", kind: "Cash", isActive: true, opening: 0, income: 0, expense: 50, transfersIn: 100, transfersOut: 0, capital: 0, closing: 50 },
    ],
    totals: { opening: 1500, income: 300, expense: 250, transfersIn: 100, transfersOut: 100, capital: 0, closing: 1550 },
    partners: [{ partnerId: 1, name: "Anil Kumar", opening: 6000, added: 2000, returned: 500, closing: 7500, share: 62.5 }, { partnerId: 2, name: "Rafi Khan", opening: 4500, added: 0, returned: 0, closing: 4500, share: 37.5 }],
    period: { income: 300, expense: 250, net: 50 },
    incomeCategories: [{ categoryId: 10, name: "Other income", amount: 300, count: 1, share: 100 }],
    expenseCategories: [{ categoryId: 1, name: "Rent", amount: 200, count: 1, share: 80 }, { categoryId: 2, name: "Fuel", amount: 50, count: 2, share: 20 }],
    months: [
      { month: "2026-10", entries: 2, income: 100, expense: 400.5, net: -300.5, capital: 0, isLocked: true, lockedBy: "manager1", lockedUtc: "2026-11-01T08:00:00Z" },
      { month: "2026-11", entries: 3, income: 200, expense: 0, net: 200, capital: 5000, isLocked: false, lockedBy: null, lockedUtc: null },
    ],
    entryCount: 4, ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getFinReport).mockResolvedValue(report());
});

it("opens on this month and shows the closing balance, the bridge and the account statement", async () => {
  render(<FinanceReportsPage />);
  const panel = await screen.findByRole("region", { name: /closing balance/i });
  expect(financeApi.getFinReport).toHaveBeenCalledWith("2026-11-01", "2026-11-25");
  expect(within(panel).getByText("1,550.00")).toBeInTheDocument();
  expect(within(panel).getByText(/AED 50.00/)).toBeInTheDocument(); // net result
  const table = screen.getByRole("table", { name: /statement by account/i });
  const rak = within(table).getByText("RAKBANK Current").closest("tr")!;
  expect(within(rak).getAllByRole("cell").map((c) => c.textContent)).toEqual(["RAKBANK Current", "1,500.00", "300.00", "200.00", "0.00", "100.00", "0.00", "1,500.00"]);
  expect(within(table).getByText("Total").closest("tr")).toHaveTextContent("1,550.00");
});

it("shows each partner's capital with the exact share to two decimals", async () => {
  render(<FinanceReportsPage />);
  await screen.findByText("Partners' capital");
  const anil = screen.getByText("Anil Kumar").closest("li")!;
  expect(within(anil).getByText("62.50%")).toBeInTheDocument();
  expect(within(anil).getByText(/Opening 6,000.00 · added 2,000.00 · returned 500.00/)).toBeInTheDocument();
  expect(screen.getByText("37.50%")).toBeInTheDocument();
});

it("compares month by month: each month's totals, a locked or open marker, and a total row", async () => {
  vi.mocked(financeApi.getFinReport).mockResolvedValue(report({ from: "2026-10-01", to: "2026-11-25" }));
  render(<FinanceReportsPage />);
  const table = await screen.findByRole("table", { name: /for each month/i });
  const oct = within(table).getByText("Oct 2026").closest("tr")!;
  expect(within(oct).getAllByRole("cell").map((c) => c.textContent?.trim())).toEqual(["Oct 2026", "2", "100.00", "400.50", "−300.50", "0.00", "Locked"]);
  const nov = within(table).getByText("Nov 2026").closest("tr")!;
  expect(within(nov).getByText("Open")).toBeInTheDocument();
  expect(within(nov).getByText("1 to 25 Nov only")).toBeInTheDocument(); // the period ends on the 25th
  expect(within(table).getByText("Total").closest("tr")).toHaveTextContent("300.00");
});

it("lists income and expenses by category with shares", async () => {
  render(<FinanceReportsPage />);
  await screen.findByText("Expenses by category");
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("80.0%")).toBeInTheDocument();
  expect(screen.getByText("Other income")).toBeInTheDocument();
});

it("loads last month when it is picked, and a typed date becomes Custom", async () => {
  render(<FinanceReportsPage />);
  await screen.findByRole("region", { name: /closing balance/i });
  await userEvent.click(screen.getByRole("radio", { name: "Last month" }));
  await waitFor(() => expect(financeApi.getFinReport).toHaveBeenLastCalledWith("2026-10-01", "2026-10-31"));
  expect(screen.getByRole("radio", { name: "Last month" })).toHaveAttribute("aria-checked", "true");
});

it("refuses a backwards range without asking the server, and disables the downloads", async () => {
  render(<FinanceReportsPage />);
  await screen.findByRole("region", { name: /closing balance/i });
  const calls = vi.mocked(financeApi.getFinReport).mock.calls.length;
  const from = screen.getByLabelText("From date");
  await userEvent.clear(from);
  await userEvent.type(from, "2026-12-01");
  expect(await screen.findByRole("alert")).toHaveTextContent(/before the start/);
  expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled();
  expect(vi.mocked(financeApi.getFinReport).mock.calls.length).toBe(calls);
});

it("downloads each format for the shown period", async () => {
  vi.mocked(financeApi.getFinReportFile).mockResolvedValue(new Blob(["x"]));
  render(<FinanceReportsPage />);
  await screen.findByRole("region", { name: /closing balance/i });
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  await waitFor(() => expect(financeApi.getFinReportFile).toHaveBeenCalledWith("csv", "2026-11-01", "2026-11-25"));
  await waitFor(() => expect(download.saveBlob).toHaveBeenCalledWith(expect.any(Blob), "Finance_Report_2026-11-01_2026-11-25.csv"));
  await userEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() => expect(financeApi.getFinReportFile).toHaveBeenCalledWith("pdf", "2026-11-01", "2026-11-25"));
});

it("says so when a download fails, and when loading fails", async () => {
  vi.mocked(financeApi.getFinReportFile).mockRejectedValue(new ApiError(422, "The PDF supports English text."));
  render(<FinanceReportsPage />);
  await screen.findByRole("region", { name: /closing balance/i });
  await userEvent.click(screen.getByRole("button", { name: "PDF" }));
  expect(await screen.findByText(/supports English text/)).toBeInTheDocument();
});

it("shows an error with retry when the report cannot load", async () => {
  vi.mocked(financeApi.getFinReport).mockRejectedValueOnce(new ApiError(500, "Server error"));
  render(<FinanceReportsPage />);
  expect(await screen.findByText(/server error/i)).toBeInTheDocument();
});
