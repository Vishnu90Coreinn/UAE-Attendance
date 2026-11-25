import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { LedgerAccount, LedgerCheckResult } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { BooksPage } from "./BooksPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const account = (over: Partial<LedgerAccount>): LedgerAccount => ({ id: 1, code: "1100", name: "RAKBANK Current", type: "Asset", isActive: true, isSystem: false, debit: 0, credit: 0, balance: 0, ...over });
const trial = {
  asOf: "2026-11-25", totalDebit: 12_500, totalCredit: 12_500, balanced: true,
  accounts: [
    account({ debit: 10_162, credit: 0, balance: 10_162 }),
    account({ id: 2, code: "3900", name: "Opening balance equity", type: "Equity", isSystem: true, credit: 10_162, balance: 10_162 }),
    account({ id: 3, code: "5010", name: "Office Rent", type: "Expense", debit: 2_338, balance: 2_338 }),
  ],
};
const agree: LedgerCheckResult = { allAgree: true, journals: 4, totalDebit: 12_500, totalCredit: 12_500, checks: [{ name: "Account balance", subject: "RAKBANK Current", ledger: 10_162, screens: 10_162, agrees: true }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role: "Manager" }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(financeApi.getLedgerChart).mockResolvedValue(trial.accounts);
  vi.mocked(financeApi.getLedgerTrialBalance).mockResolvedValue(trial);
  vi.mocked(financeApi.getLedgerCheck).mockResolvedValue(agree);
});

it("shows the trial balance grouped by type, with equal totals", async () => {
  render(<BooksPage />);

  expect(await screen.findByText("The books agree with the finance screens")).toBeInTheDocument();
  expect(screen.getByText("RAKBANK Current")).toBeInTheDocument();
  expect(screen.getByText("Opening balance equity")).toBeInTheDocument();
  expect(screen.getAllByText("12,500.00")).toHaveLength(2);
  expect(screen.queryByText(/does not balance/)).not.toBeInTheDocument();
});

it("says exactly where the books and the screens disagree", async () => {
  vi.mocked(financeApi.getLedgerCheck).mockResolvedValue({ ...agree, allAgree: false, checks: [{ name: "Account balance", subject: "Main cash", ledger: 100, screens: 90, agrees: false }] });
  render(<BooksPage />);

  expect(await screen.findByText("The books and the finance screens disagree")).toBeInTheDocument();
  expect(screen.getByText(/Account balance \(Main cash\): books 100.00, screens 90.00/)).toBeInTheDocument();
});

it("opens an account's ledger from the trial balance, with a running balance and its reversals marked", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.getLedgerStatement).mockResolvedValue({
    account: account({}), from: "2000-01-01", to: "2026-11-25", opening: 0, closing: 10_162,
    lines: [
      { date: "2026-09-01", journalNumber: "JNL-000001", description: "Opening balance of RAKBANK", memo: null, debit: 10_162, credit: 0, balance: 10_162, part: "Post" },
      { date: "2026-09-02", journalNumber: "JNL-000009", description: "Reversal of JNL-000008: EXP-000003 Taxi", memo: null, debit: 50, credit: 0, balance: 10_212, part: "Reversal" },
    ],
  });
  render(<BooksPage />);

  await user.click(await screen.findByRole("button", { name: "RAKBANK Current" }));

  expect(await screen.findByText("Opening balance of RAKBANK")).toBeInTheDocument();
  expect(screen.getByText("Reversal")).toBeInTheDocument();
  expect(financeApi.getLedgerStatement).toHaveBeenCalledWith(1, "2000-01-01", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
});

it("lets a Manager post a journal only when debits equal credits, and sends it", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.listJournals).mockResolvedValue({ items: [], count: 0, truncated: false });
  vi.mocked(financeApi.postManualJournal).mockResolvedValue({ id: 9, number: "JNL-000009", date: "2026-11-24", sourceType: "Manual", sourceId: 1, part: "Post", description: "Bank charge", lines: [], isManual: true });
  render(<BooksPage />);

  await user.click(await screen.findByRole("tab", { name: "Journals" }));
  await user.click(await screen.findByRole("button", { name: "Post a journal" }));
  await user.type(screen.getByLabelText("What it is for"), "Bank charge not yet entered");
  await user.selectOptions(screen.getByLabelText("Line 1 account"), "3");
  await user.type(screen.getByLabelText("Line 1 debit"), "12.50");
  await user.selectOptions(screen.getByLabelText("Line 2 account"), "1");
  await user.type(screen.getByLabelText("Line 2 credit"), "10");

  await user.click(screen.getByRole("button", { name: "Post journal" }));
  expect(await screen.findByText(/Debits are 12.50 and credits are 10.00/)).toBeInTheDocument();
  expect(financeApi.postManualJournal).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText("Line 2 credit"));
  await user.type(screen.getByLabelText("Line 2 credit"), "12.50");
  expect(screen.getByText(/Balanced/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Post journal" }));

  await waitFor(() => expect(financeApi.postManualJournal).toHaveBeenCalledWith(expect.objectContaining({
    description: "Bank charge not yet entered",
    lines: [expect.objectContaining({ accountId: 3, debit: 12.5 }), expect.objectContaining({ accountId: 1, credit: 12.5 })],
  })));
});

it("offers the Partner no way to post, reverse, edit or remap", async () => {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "p", role: "Viewer" }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(financeApi.listJournals).mockResolvedValue({ items: [], count: 0, truncated: false });
  const user = userEvent.setup();
  render(<BooksPage />);

  await user.click(await screen.findByRole("tab", { name: "Journals" }));
  expect(screen.queryByRole("button", { name: "Post a journal" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Chart of accounts" }));
  expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
});
