import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinPartners } from "../../api/finance";
import { GetStartedCard } from "./GetStartedCard";

vi.mock("../../api/finance");

const account = (openingBalance: number) => ({ id: 1, name: "RAKBANK", kind: "Bank", openingBalance, isActive: true }) as FinAccount;
const partners = (n: number) => ({ partners: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) }) as unknown as FinPartners;

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account(0)]);
  vi.mocked(financeApi.listFinPartners).mockResolvedValue(partners(0));
  vi.mocked(financeApi.listFinCategories).mockResolvedValue([{ id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 0 }]);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
});

const show = () => render(<MemoryRouter><GetStartedCard /></MemoryRouter>);

it("ticks off what is already there and links to the rest", async () => {
  show();

  expect(await screen.findByText("1 of 5 done")).toBeInTheDocument();      // only the accounts exist
  expect(screen.getByRole("link", { name: /Say which VAT/ })).toHaveAttribute("href", "/finance/setup#categories");
});

it("disappears once everything is done", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account(5000)]);
  vi.mocked(financeApi.listFinPartners).mockResolvedValue(partners(2));
  vi.mocked(financeApi.listFinCategories).mockResolvedValue([{ id: 4, kind: "Expense", name: "Monthly Salary", isActive: true, useCount: 0, noVat: true }]);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([{ month: "2026-10", isLocked: true, lockedBy: "m", lockedUtc: null, unlockedBy: null, unlockedUtc: null, unlockReason: null }]);
  const { container } = show();

  await new Promise((r) => setTimeout(r, 30));
  expect(container).toBeEmptyDOMElement();
});

it("can be hidden, and stays hidden", async () => {
  const first = show();
  await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
  expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  first.unmount();

  const again = show();
  await new Promise((r) => setTimeout(r, 30));
  expect(again.container).toBeEmptyDOMElement();
});
