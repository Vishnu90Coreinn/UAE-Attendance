import { render, screen } from "@testing-library/react";
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

  await user.click(screen.getByRole("button", { name: "Last month" }));

  expect(financeApi.getFinVatReport).toHaveBeenCalledTimes(2);
});
