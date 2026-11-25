import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCategory, FinEntry, FinTaxType } from "../../api/finance";
import { EntryDialog } from "./EntryDialog";

vi.mock("../../api/finance");

const account: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 900, entryCount: 0 };
const categories: FinCategory[] = [
  { id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 0 },
  { id: 2, kind: "Expense", name: "Government fees", isActive: true, useCount: 0, defaultTaxTypeId: 3 },
];
const taxTypes: FinTaxType[] = [
  { id: 1, name: "Standard Rated (VAT)", treatment: "Standard", rate: 5 }, { id: 3, name: "Exempt", treatment: "Exempt", rate: 0 },
  { id: 4, name: "Reverse Charges (VAT)", treatment: "ReverseCharge", rate: 5 },
];

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinParties).mockResolvedValue([]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue(taxTypes);
  vi.mocked(financeApi.createFinEntry).mockResolvedValue({ id: 1, entryNo: "EXP-000001", amount: 105, party: "Supplier" } as FinEntry);
});

async function open(amount = "105") {
  const user = userEvent.setup();
  render(<EntryDialog kind="Expense" accounts={[account]} categories={categories} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByLabelText("VAT type");
  await user.type(screen.getByLabelText("Amount (AED)"), amount);
  await user.type(screen.getByLabelText("Paid to"), "Supplier");
  await user.selectOptions(screen.getByLabelText("Paid from"), "1");
  await user.selectOptions(screen.getByLabelText("Category"), "1");
  await user.upload(document.querySelector('input[type="file"][accept^="application/pdf"]') as HTMLInputElement, new File(["%PDF-1.4"], "r.pdf", { type: "application/pdf" }));
  return user;
}

it("starts on standard rated and shows the VAT inside the amount typed", async () => {
  await open("105");

  expect(screen.getByLabelText("VAT type")).toHaveValue("1");
  expect(screen.getByText("Includes VAT of AED 5.00 on a net of AED 100.00.")).toBeInTheDocument();
});

it("says the total when the VAT is added on top, and sends what was chosen", async () => {
  const user = await open("100");

  await user.click(screen.getByRole("checkbox", { name: "The amount already includes VAT" }));
  expect(screen.getByText("VAT AED 5.00 is added: the total paid is AED 105.00.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalled());
  const input = vi.mocked(financeApi.createFinEntry).mock.calls[0][1];
  expect(input.taxTypeId).toBe(1);
  expect(input.taxInclusive).toBe(false);
  expect(input.amount).toBe(100);   // what was typed; the server adds the VAT
});

it("explains reverse charge: nothing extra is paid, the company accounts for the VAT", async () => {
  const user = await open("1000");

  await user.selectOptions(screen.getByLabelText("VAT type"), "4");

  expect(screen.getByText(/No VAT is paid in cash. The company accounts for AED 50.00 of VAT itself/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "The amount already includes VAT" })).not.toBeInTheDocument();
});

it("follows the category's VAT type until the person chooses one themselves", async () => {
  const user = await open("300");

  await user.selectOptions(screen.getByLabelText("Category"), "2");
  expect(screen.getByLabelText("VAT type")).toHaveValue("3");   // government fees offer Exempt

  await user.selectOptions(screen.getByLabelText("VAT type"), "0");
  await user.selectOptions(screen.getByLabelText("Category"), "1");
  expect(screen.getByLabelText("VAT type")).toHaveValue("0");   // their own choice stays
});

it("sends 'no VAT recorded' as zero, so the server does not apply a default behind their back", async () => {
  const user = await open("50");
  await user.selectOptions(screen.getByLabelText("VAT type"), "0");

  await user.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalled());
  expect(vi.mocked(financeApi.createFinEntry).mock.calls[0][1].taxTypeId).toBe(0);
});

it("shows no VAT choice when the money goes to the tax authority, and says why", async () => {
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue(taxTypes);
  const user = userEvent.setup();
  render(<EntryDialog kind="Expense" accounts={[account]} categories={[...categories, { id: 13, kind: "Expense", name: "VAT paid to tax authority", isActive: true, useCount: 0 }]} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByLabelText("VAT type");

  await user.selectOptions(screen.getByLabelText("Category"), "13");

  expect(screen.queryByLabelText("VAT type")).not.toBeInTheDocument();
  expect(screen.getByText(/settles VAT with the tax authority/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Category"), "1");
  expect(screen.getByLabelText("VAT type")).toBeInTheDocument();      // an ordinary category brings it back
});
