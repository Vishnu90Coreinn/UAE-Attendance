import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAttention } from "../../api/finance";
import { AttentionCard } from "./AttentionCard";

vi.mock("../../api/finance");

const none = { count: 0, amount: 0 };
const data = (over: Partial<FinAttention> = {}): FinAttention => ({
  overdueBills: none, billsDueSoon: none, overdueCheques: none, chequesDueSoon: none, overdueInvoices: none, pendingApprovals: 0, openMonth: null,
  vatPeriod: "1 Oct 2026 to 31 Dec 2026", vatDue: "2027-01-28", vatDaysLeft: 64, ...over,
});

beforeEach(() => vi.resetAllMocks());

it("lists only what needs doing, with amounts, and always shows the next VAT return", async () => {
  vi.mocked(financeApi.getFinAttention).mockResolvedValue(data({
    overdueBills: { count: 2, amount: 1575 }, billsDueSoon: { count: 1, amount: 300 }, overdueInvoices: { count: 1, amount: 4200 }, pendingApprovals: 3, openMonth: "October 2026",
  }));
  render(<MemoryRouter><AttentionCard canLock /></MemoryRouter>);

  expect(await screen.findByText(/2 supplier bills are/)).toBeInTheDocument();
  expect(screen.getByText("AED 1,575.00")).toBeInTheDocument();
  expect(screen.getByText(/1 bill due in the next 7 days/)).toBeInTheDocument();
  expect(screen.getByText(/1 tax invoice is overdue/)).toBeInTheDocument();
  expect(screen.getByText(/3 staff expenses wait for your approval/)).toBeInTheDocument();
  expect(screen.getByText(/October 2026 is over but not locked yet/)).toBeInTheDocument();
  expect(screen.getByText(/VAT return for 1 Oct 2026 to 31 Dec 2026: due/)).toBeInTheDocument();
  expect(screen.getByText(/64 days left/)).toBeInTheDocument();
  expect(screen.queryByText(/cheque/)).not.toBeInTheDocument();                  // nothing to say about cheques, so nothing is said
  expect(screen.getByRole("link", { name: /supplier bills are/ })).toHaveAttribute("href", "/finance/bills");
});

it("says all is quiet when nothing is due, and hides the lock reminder from someone who cannot lock", async () => {
  vi.mocked(financeApi.getFinAttention).mockResolvedValue(data({ openMonth: "October 2026" }));
  render(<MemoryRouter><AttentionCard canLock={false} /></MemoryRouter>);

  expect(await screen.findByText("Nothing is overdue and nothing waits for you.")).toBeInTheDocument();
  expect(screen.queryByText(/not locked yet/)).not.toBeInTheDocument();
});

it("shows nothing at all when the figures cannot be loaded", async () => {
  vi.mocked(financeApi.getFinAttention).mockRejectedValue(new Error("down"));
  const { container } = render(<MemoryRouter><AttentionCard canLock /></MemoryRouter>);

  await new Promise((r) => setTimeout(r, 20));
  expect(container).toBeEmptyDOMElement();
});
