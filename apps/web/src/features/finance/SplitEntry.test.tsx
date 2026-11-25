import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCategory, FinEntry } from "../../api/finance";
import { EntryDialog } from "./EntryDialog";

vi.mock("../../api/finance");

const account: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 900, entryCount: 0 };
const categories: FinCategory[] = [
  { id: 5, kind: "Expense", name: "Worker Accommodation Rent", isActive: true, useCount: 0 },
  { id: 9, kind: "Expense", name: "Commission for Labor", isActive: true, useCount: 0 },
];
const saved = { id: 1, entryNo: "EXP-000001", amount: 5000, party: "Housing agent" } as FinEntry;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinParties).mockResolvedValue([]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.createFinEntry).mockResolvedValue(saved);
});

async function open() {
  const user = userEvent.setup();
  render(<EntryDialog kind="Expense" accounts={[account]} categories={categories} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  await user.type(screen.getByLabelText("Amount (AED)"), "5000");
  await user.type(screen.getByLabelText("Paid to"), "Housing agent");
  await user.selectOptions(screen.getByLabelText("Paid from"), "1");
  await user.upload(document.querySelector('input[type="file"][accept^="application/pdf"]') as HTMLInputElement, new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" }));
  await user.click(screen.getByRole("button", { name: /Split between categories/ }));
  return user;
}

it("says how much is still to assign, and that the lines add up once they do", async () => {
  const user = await open();

  await user.selectOptions(screen.getByLabelText("Line 1 category"), "5");
  await user.clear(screen.getByLabelText("Line 1 amount"));
  await user.type(screen.getByLabelText("Line 1 amount"), "2000");
  expect(screen.getByText("AED 3,000.00 still to assign")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Line 2 category"), "9");
  await user.type(screen.getByLabelText("Line 2 amount"), "3000");
  expect(screen.getByText("The lines add up.")).toBeInTheDocument();
});

it("will not save lines that do not add up to the amount", async () => {
  const user = await open();
  await user.selectOptions(screen.getByLabelText("Line 1 category"), "5");
  await user.clear(screen.getByLabelText("Line 1 amount"));
  await user.type(screen.getByLabelText("Line 1 amount"), "2000");
  await user.selectOptions(screen.getByLabelText("Line 2 category"), "9");
  await user.type(screen.getByLabelText("Line 2 amount"), "2500");

  await user.click(screen.getByRole("button", { name: "Save expense" }));

  expect(await screen.findByText(/AED 500.00 is still to be put on a line/)).toBeInTheDocument();
  expect(financeApi.createFinEntry).not.toHaveBeenCalled();
});

it("sends every line, with its note, when they add up", async () => {
  const user = await open();
  await user.selectOptions(screen.getByLabelText("Line 1 category"), "5");
  await user.clear(screen.getByLabelText("Line 1 amount"));
  await user.type(screen.getByLabelText("Line 1 amount"), "2000");
  await user.type(screen.getByLabelText("Line 1 note"), "Security deposit");
  await user.selectOptions(screen.getByLabelText("Line 2 category"), "9");
  await user.type(screen.getByLabelText("Line 2 amount"), "3000");

  await user.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalled());
  const input = vi.mocked(financeApi.createFinEntry).mock.calls[0][1];
  expect(input.amount).toBe(5000);
  expect(input.categoryId).toBe(9);   // the largest line's category stands for the entry
  expect(input.lines).toEqual([{ categoryId: 5, amount: 2000, note: "Security deposit" }, { categoryId: 9, amount: 3000, note: undefined }]);
});
