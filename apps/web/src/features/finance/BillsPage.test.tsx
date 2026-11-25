import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinBill } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { BillsPage } from "./BillsPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const bank = { id: 1, name: "RAKBANK Current", kind: "Bank", isActive: true } as FinAccount;
const bill = (over: Partial<FinBill> = {}): FinBill => ({
  id: 1, billNo: "BILL-000001", supplierName: "Gulf Aluminium Supplies", payeeId: null, supplierRef: "SUP-77", billDate: "2026-10-01", dueDate: "2026-10-31", notes: null, status: "Open", display: "Overdue",
  taxTypeId: 1, taxType: "Standard Rated (VAT)", taxAmount: 75, net: 1500, total: 1575, paid: 0, balance: 1575,
  lines: [{ categoryId: 1, category: "Company expenses", amount: 1500, note: null }], payments: [], voidReason: null, createdBy: "m", ...over,
});

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinBills).mockResolvedValue([bill(), bill({ id: 2, billNo: "BILL-000002", supplierName: "Part Paid Co", display: "PartPaid", paid: 500, balance: 1075, payments: [{ entryId: 9, entryNo: "EXP-000300", date: "2026-11-02", amount: 500, account: "RAKBANK Current", reference: null }] })]);
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([bank]);
  vi.mocked(financeApi.listFinCategories).mockResolvedValue([{ id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 0 }]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue([{ id: 1, name: "Standard Rated (VAT)", treatment: "Standard", rate: 5 }]);
});

it("lists bills with a status word, what is still owed, and the total on the list", async () => {
  render(<MemoryRouter><BillsPage /></MemoryRouter>);

  expect(await screen.findByText("Gulf Aluminium Supplies")).toBeInTheDocument();
  expect(screen.getByText(/Overdue since/)).toBeInTheDocument();
  expect(screen.getByText("Part paid")).toBeInTheDocument();
  expect(screen.getByText("1,075.00 still owed")).toBeInTheDocument();
  expect(screen.getByText("AED 2,650.00")).toBeInTheDocument();          // 1,575 + 1,075 owed
  expect(financeApi.listFinBills).toHaveBeenCalledWith("unpaid", "");
});

it("only offers Void while nothing has been paid, and Take back for a payment", async () => {
  render(<MemoryRouter><BillsPage /></MemoryRouter>);
  await screen.findByText("Gulf Aluminium Supplies");

  expect(screen.getByRole("button", { name: "Void BILL-000001" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Void BILL-000002" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Take back payment EXP-000300" })).toBeInTheDocument();
});

it("pays a bill from the chosen account", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([bank, { ...bank, id: 2, name: "Main cash", kind: "Cash" } as FinAccount]);   // two accounts, so none is chosen for you
  vi.mocked(financeApi.payFinBill).mockResolvedValue(bill({ display: "Paid", paid: 1575, balance: 0 }));
  render(<MemoryRouter><BillsPage /></MemoryRouter>);

  await userEvent.click(await screen.findByRole("button", { name: "Pay BILL-000001" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save payment" }));
  expect(await within(dialog).findByText("Choose the account the money is paid from.")).toBeInTheDocument();     // the account must be chosen
  await userEvent.selectOptions(within(dialog).getByLabelText("Paid from"), "1");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save payment" }));

  await waitFor(() => expect(financeApi.payFinBill).toHaveBeenCalledWith(1, expect.objectContaining({ amount: 1575, accountId: 1 })));
});

it("needs a reason to void a bill", async () => {
  vi.mocked(financeApi.voidFinBill).mockResolvedValue(bill({ status: "Voided", display: "Voided" }));
  render(<MemoryRouter><BillsPage /></MemoryRouter>);

  await userEvent.click(await screen.findByRole("button", { name: "Void BILL-000001" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Void bill" }));
  expect(await within(dialog).findByText(/Enter the reason/)).toBeInTheDocument();
  expect(financeApi.voidFinBill).not.toHaveBeenCalled();
  await userEvent.type(within(dialog).getByLabelText("Reason for voiding"), "Duplicate");
  await userEvent.click(within(dialog).getByRole("button", { name: "Void bill" }));

  await waitFor(() => expect(financeApi.voidFinBill).toHaveBeenCalledWith(1, "Duplicate"));
});

it("enters a bill with its lines and VAT type, showing the VAT before saving", async () => {
  vi.mocked(financeApi.createFinBill).mockResolvedValue(bill());
  render(<MemoryRouter><BillsPage /></MemoryRouter>);

  await userEvent.click(await screen.findByRole("button", { name: "Enter bill" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Supplier"), "Gulf Aluminium Supplies");
  await userEvent.selectOptions(within(dialog).getByLabelText("Category 1"), "1");
  await userEvent.type(within(dialog).getByLabelText("Amount 1"), "1500");
  expect(within(dialog).getByText(/VAT AED 75.00. The supplier is owed AED 1,575.00/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Enter bill" }));

  await waitFor(() => expect(financeApi.createFinBill).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "Gulf Aluminium Supplies", taxTypeId: 1, lines: [{ categoryId: 1, amount: 1500, note: "" }] })));
});

it("shows a Viewer the bills but no buttons to change them", async () => {
  signIn("Viewer");
  render(<MemoryRouter><BillsPage /></MemoryRouter>);

  expect(await screen.findByText("Gulf Aluminium Supplies")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enter bill" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
});
