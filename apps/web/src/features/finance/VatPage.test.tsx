import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinVatReport } from "../../api/finance";
import { VatPage } from "./VatPage";

vi.mock("../../api/finance");

const report = (over: Partial<FinVatReport> = {}): FinVatReport => ({
  from: "2026-11-01", to: "2026-11-25", outputVat: 150, inputVat: 55, netPayable: 95,
  sales: [{ taxTypeId: 1, taxType: "Standard Rated (VAT)", treatment: "Standard", rate: 5, count: 1, net: 2000, vat: 100 }],
  purchases: [{ taxTypeId: 4, taxType: "Reverse Charges (VAT)", treatment: "ReverseCharge", rate: 5, count: 1, net: 1000, vat: 50 }],
  unrecordedSales: { count: 0, amount: 0 }, unrecordedPurchases: { count: 1, amount: 70 }, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getFinVatReport).mockResolvedValue(report());
});

it("preserves dates selected while assigned-period settings are loading", async () => {
  let finish!: (v: financeApi.FinanceTaxPeriodSettings) => void;
  vi.mocked(financeApi.getFinanceTaxPeriod).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<MemoryRouter><VatPage /></MemoryRouter>);
  await screen.findByText("VAT to pay");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
  await waitFor(() => expect(financeApi.getFinVatReport).toHaveBeenLastCalledWith("2026-02-01", expect.any(String)));
  await act(async () => finish({ months: 3, startMonth: 2, confirmed: true }));
  expect(screen.getByLabelText("From")).toHaveValue("2026-02-01");
});

it("shows what is owed, the sales and purchases behind it, and warns about entries with no VAT type", async () => {
  render(<MemoryRouter><VatPage /></MemoryRouter>);

  expect(await screen.findByText("VAT to pay")).toBeInTheDocument();
  expect(screen.getAllByText(/95\.00/).length).toBeGreaterThan(0);
  expect(screen.getByText("Standard Rated (VAT)")).toBeInTheDocument();
  expect(screen.getByText("Reverse Charges (VAT)")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 purchases (AED 70.00) have no VAT type");
});

it("calls a negative result a refund to reclaim", async () => {
  vi.mocked(financeApi.getFinVatReport).mockResolvedValue(report({ netPayable: -40, outputVat: 10, inputVat: 50, unrecordedPurchases: { count: 0, amount: 0 } }));
  render(<MemoryRouter><VatPage /></MemoryRouter>);

  expect(await screen.findByText("VAT to reclaim")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("asks the server again when another period is chosen", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  render(<MemoryRouter><VatPage /></MemoryRouter>);
  await screen.findByText("VAT to pay");

  await user.click(screen.getByRole("button", { name: "Last quarter" }));

  expect(financeApi.getFinVatReport).toHaveBeenCalledTimes(2);
});

it("says when the return for the quarter is due, and offers the downloads under the figures", async () => {
  render(<MemoryRouter><VatPage /></MemoryRouter>);

  await screen.findByText("VAT to pay");
  expect(screen.getByText(/VAT period has not been confirmed/)).toBeInTheDocument();
  expect(screen.queryByText(/Estimated filing deadline/)).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Download these figures" })).toBeInTheDocument();
  const [from, to] = vi.mocked(financeApi.getFinVatReport).mock.calls[0];
  expect(from).toMatch(/-(01|04|07|10)-01$/);          // the first day of a quarter
  expect(to >= from).toBe(true);
});
