import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { FinanceSetupPage } from "./FinanceSetupPage";

vi.mock("../../api/finance");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinCategories).mockResolvedValue([{ id: 4, kind: "Expense", name: "Monthly Salary", isActive: true, useCount: 2, noVat: true }]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue([{ id: 1, name: "Standard Rated (VAT)", treatment: "Standard", rate: 5 }]);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
  vi.mocked(financeApi.listFinSubmitters).mockResolvedValue([]);
});

it("puts the categories, the month lock and the staff who enter expenses on one page, with a way into the books' setup", async () => {
  render(<MemoryRouter><FinanceSetupPage /></MemoryRouter>);

  expect(screen.getByRole("heading", { name: "Finance setup" })).toBeInTheDocument();
  expect(await screen.findByText("Monthly Salary")).toBeInTheDocument();
  expect(screen.getAllByText("Month lock").length).toBeGreaterThan(1);   // the jump link and the card
  expect(screen.getByText("Staff who can enter expenses")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Chart of accounts and mapping" })).toHaveAttribute("href", "/finance/books");
  expect(screen.getByRole("link", { name: "Month lock" })).toHaveAttribute("href", "#month-lock");
});

it("shows a category that never carries VAT as such", async () => {
  render(<MemoryRouter><FinanceSetupPage /></MemoryRouter>);

  const select = await screen.findByLabelText("VAT type offered for Monthly Salary");
  expect(select).toHaveValue("0");
});
