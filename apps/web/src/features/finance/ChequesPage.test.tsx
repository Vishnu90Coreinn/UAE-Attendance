import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCheque } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { ChequesPage } from "./ChequesPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const bank: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 900, entryCount: 0 };
const cheque = (over: Partial<FinCheque> = {}): FinCheque => ({
  id: 1, direction: "Issued", serial: "000004", amount: 12000, partyName: "M S K Luxuries", issueDate: "2026-09-25", dueDate: "2026-09-25", accountId: 1, accountName: "RAKBANK Current",
  status: "Delivered", statusDate: null, statusNote: null, entryId: null, entryNo: "EXP-000186", notes: null, isOpen: true, isPostDated: false, isOverdue: false,
  nextStatuses: ["Cleared", "Bounced", "Cancelled"], createdBy: "m", createdUtc: "2026-09-25T10:00:00Z", ...over,
});

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([bank]);
  vi.mocked(financeApi.listFinCheques).mockResolvedValue({
    items: [cheque(), cheque({ id: 2, serial: "2", amount: 10000, dueDate: "2027-01-15", isPostDated: true, nextStatuses: ["Cleared", "Bounced", "Cancelled"], entryNo: null }), cheque({ id: 3, serial: "9", amount: 250, dueDate: "2026-11-01", isOverdue: true })],
    count: 3, openIssued: 22250, openReceived: 0, truncated: false,
  });
});

it("shows what is committed, and marks post-dated and overdue cheques in words", async () => {
  render(<MemoryRouter><ChequesPage /></MemoryRouter>);

  expect(await screen.findByText("22,250.00")).toBeInTheDocument();
  expect(screen.getByText("Post-dated")).toBeInTheDocument();
  expect(screen.getByText(/Overdue since/)).toBeInTheDocument();
  expect(screen.getAllByText("EXP-000186").length).toBeGreaterThan(0);   // the expense the cheque paid
});

it("moves a cheque to cleared on a chosen day", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.changeFinChequeStatus).mockResolvedValue(cheque({ status: "Cleared", isOpen: false, nextStatuses: [] }));
  render(<MemoryRouter><ChequesPage /></MemoryRouter>);

  await user.click((await screen.findAllByRole("button", { name: "Mark as cleared: cheque 000004" }))[0]);
  await user.click(screen.getByRole("button", { name: "Mark as cleared" }));

  await waitFor(() => expect(financeApi.changeFinChequeStatus).toHaveBeenCalledWith(1, "Cleared", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ""));
  expect(await screen.findByText(/Cheque 000004 is now cleared/)).toBeInTheDocument();
});

it("asks for a reason before a cheque is marked as bounced", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ChequesPage /></MemoryRouter>);

  await user.click((await screen.findAllByRole("button", { name: "Mark as bounced: cheque 000004" }))[0]);
  await user.click(screen.getByRole("button", { name: "Mark as bounced" }));

  expect(await screen.findByText("Enter why it bounced.")).toBeInTheDocument();
  expect(financeApi.changeFinChequeStatus).not.toHaveBeenCalled();
});

it("lets a Partner read the register but offers no way to change it", async () => {
  signIn("Viewer");
  render(<MemoryRouter><ChequesPage /></MemoryRouter>);

  await screen.findByText("22,250.00");
  expect(screen.queryByRole("button", { name: /Add cheque/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Mark as cleared/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit cheque/ })).not.toBeInTheDocument();
});
