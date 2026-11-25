import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { LedgerAccount, LedgerCheckResult } from "../../api/finance";
import { BooksPage } from "./BooksPage";

vi.mock("../../api/finance");

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
