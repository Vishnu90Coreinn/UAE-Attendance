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

it("sends the accountant's partial VAT recovery percentage", async () => {
  const user = await open();
  await user.selectOptions(screen.getByLabelText("VAT type"), "1");
  await user.clear(screen.getByLabelText("Recoverable VAT (%)"));
  await user.type(screen.getByLabelText("Recoverable VAT (%)"), "40");
  await user.click(screen.getByRole("button", { name: "Save expense" }));
  expect(financeApi.createFinEntry).toHaveBeenCalledWith("Expense", expect.objectContaining({ recoverableTaxPercent: 40 }));
});

it("does not interpret an empty recovery percentage as fully blocked VAT", async () => {
  const user = await open();
  await user.selectOptions(screen.getByLabelText("VAT type"), "1");
  await user.clear(screen.getByLabelText("Recoverable VAT (%)"));
  await user.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByText("Enter a VAT recovery percentage from 0 to 100.")).toBeInTheDocument();
  expect(financeApi.createFinEntry).not.toHaveBeenCalled();
});

it("does not assume a VAT type: a category with no VAT setting asks, and saving without a choice is refused", async () => {
  const user = await open("105");

  expect(screen.getByLabelText("VAT type")).toHaveValue("");              // nothing is assumed, so a salary can never pick up VAT by accident
  await user.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByText(/Choose the VAT type/)).toBeInTheDocument();
  expect(financeApi.createFinEntry).not.toHaveBeenCalled();

  await user.selectOptions(screen.getByLabelText("VAT type"), "1");
  expect(screen.getByText("Includes VAT of AED 5.00 on a net of AED 100.00.")).toBeInTheDocument();
});

it("starts on no VAT for a category that never carries it, and on the VAT type last chosen for a category", async () => {
  const user = userEvent.setup();
  const withRules: FinCategory[] = [
    ...categories,
    { id: 4, kind: "Expense", name: "Monthly Salary", isActive: true, useCount: 0, noVat: true },
    { id: 9, kind: "Expense", name: "Pest control", isActive: true, useCount: 0 },
  ];
  localStorage.setItem("hrpayroll.finance.catTax.9", "1");                   // chosen for this category last time
  render(<EntryDialog kind="Expense" accounts={[account]} categories={withRules} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByLabelText("Category");

  await user.selectOptions(screen.getByLabelText("Category"), "4");
  await screen.findByLabelText("VAT type");
  expect(screen.getByLabelText("VAT type")).toHaveValue("0");
  await user.selectOptions(screen.getByLabelText("Category"), "9");
  expect(screen.getByLabelText("VAT type")).toHaveValue("1");
});

it("keeps the app's own categories off the form", async () => {
  render(<EntryDialog kind="Expense" accounts={[account]} categories={[...categories, { id: 20, kind: "Expense", name: "Supplier bill payments", isActive: true, useCount: 0, isSystem: true }]} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByLabelText("Category");

  expect(screen.queryByRole("option", { name: "Supplier bill payments" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Company expenses" })).toBeInTheDocument();
});

it("says the total when the VAT is added on top, and sends what was chosen", async () => {
  const user = await open("100");

  await user.selectOptions(screen.getByLabelText("VAT type"), "1");
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

it("saves and stays open for the next one, keeping the date, account and category", async () => {
  const onSaved = vi.fn();
  const onContinue = vi.fn();
  const user = userEvent.setup();
  render(<EntryDialog kind="Expense" accounts={[account]} categories={categories} variant="center" onClose={vi.fn()} onSaved={onSaved} onSavedAndContinue={onContinue} />);
  await screen.findByLabelText("VAT type");
  await user.type(screen.getByLabelText("Amount (AED)"), "105");
  await user.type(screen.getByLabelText("Paid to"), "Supplier");
  await user.selectOptions(screen.getByLabelText("Paid from"), "1");
  await user.selectOptions(screen.getByLabelText("Category"), "1");
  await user.selectOptions(screen.getByLabelText("VAT type"), "1");
  await user.upload(document.querySelector('input[type="file"][accept^="application/pdf"]') as HTMLInputElement, new File(["%PDF-1.4"], "r.pdf", { type: "application/pdf" }));

  await user.click(screen.getByRole("button", { name: "Save and add another" }));

  await waitFor(() => expect(onContinue).toHaveBeenCalled());
  expect(onSaved).not.toHaveBeenCalled();                                  // the dialog stays open
  expect(screen.getByRole("status")).toHaveTextContent("EXP-000001");
  expect(screen.getByLabelText("Amount (AED)")).toHaveValue("");           // cleared for the next receipt
  expect(screen.getByLabelText("Paid to")).toHaveValue("");
  expect(screen.getByLabelText("Paid from")).toHaveValue("1");             // kept
  expect(screen.getByLabelText("Category")).toHaveValue("1");
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
});

it("offers the camera only on a phone", async () => {
  const { unmount } = render(<EntryDialog kind="Expense" accounts={[account]} categories={categories} variant="center" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByText("Take photo")).not.toBeInTheDocument();
  unmount();
  render(<EntryDialog kind="Expense" accounts={[account]} categories={categories} variant="sheet" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByText("Take photo")).toBeInTheDocument();
});
