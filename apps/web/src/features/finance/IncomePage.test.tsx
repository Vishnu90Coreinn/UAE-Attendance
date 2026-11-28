import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCategory, FinEntry } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { IncomePage } from "./IncomePage";
import { AppToaster } from "../../ui";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const account: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 900, entryCount: 2 };
const categories: FinCategory[] = [
  { id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 2 },
  { id: 10, kind: "Income", name: "Other income", isActive: true, useCount: 1 },
];
const entry: FinEntry = {
  id: 3, kind: "Income", entryNo: "INC-000003", entryDate: "2026-11-23", categoryId: 10, categoryName: "Other income", party: "One by Binghatti",
  accountId: 1, accountName: "RAKBANK Current", amount: 111767.04, reference: null, notes: null, status: "Active", voidReason: null,
  createdBy: "m", createdUtc: "2026-11-23T08:00:00Z", attachments: [],
  voidedBy: null, voidedUtc: null, replacesEntryId: null, replacesEntryNo: null, replacedByEntryNo: null,
};

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

const client = (over: Partial<financeApi.FinClient> = {}): financeApi.FinClient => ({
  id: 12, name: "Al Noor Contracting", trn: "", address: "", isActive: true, entryCount: 0, total: 0, unpaid: 0, unpaidInvoices: [], ...over,
});

// Results of actions are said in toasts, which need the toaster App mounts.
beforeEach(() => {
  render(<AppToaster />);
});

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account]);
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
  vi.mocked(financeApi.listFinParties).mockResolvedValue([]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue([]);
  vi.mocked(financeApi.listFinEntries).mockResolvedValue({ items: [entry], total: 111767.04, count: 1, truncated: false });
  vi.mocked(financeApi.listFinClients).mockResolvedValue([]);
});

it("lists income with its own wording and asks the server for income", async () => {
  render(<MemoryRouter><IncomePage /></MemoryRouter>);

  expect((await screen.findAllByText("111,767.04")).length).toBe(2); // the total and the row
  expect(screen.getByRole("heading", { name: "Income" })).toBeInTheDocument();
  expect(screen.getByText("Total received", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("Received from")).toBeInTheDocument();
  expect(screen.getByText("One by Binghatti")).toBeInTheDocument();
  expect(financeApi.listFinEntries).toHaveBeenCalledWith("Income", expect.anything());
});

it("offers only income categories when adding", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><IncomePage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add income" }));
  const dialog = await screen.findByRole("dialog");

  const options = within(dialog).getAllByRole("option").map((o) => o.textContent);
  expect(options).toContain("Other income");
  expect(options).not.toContain("Company expenses");
  expect(within(dialog).getByLabelText("Received into")).toBeInTheDocument();
});

it("saves income without any attachment", async () => {
  vi.mocked(financeApi.createFinEntry).mockResolvedValue({ ...entry, id: 4, entryNo: "INC-000004", amount: 250, party: "Client A" });
  const user = userEvent.setup();
  render(<MemoryRouter><IncomePage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add income" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Amount (AED)"), "250");
  await user.selectOptions(within(dialog).getByLabelText("Category"), "10");
  await user.selectOptions(within(dialog).getByLabelText("Received into"), "1");
  await user.type(within(dialog).getByLabelText("Received from"), "Client A");
  await user.click(within(dialog).getByRole("button", { name: "Save income" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalledWith("Income", expect.objectContaining({ amount: 250, categoryId: 10, party: "Client A", files: [] })));
  expect(await screen.findByText(/INC-000004: AED 250.00 received from Client A/)).toBeInTheDocument();
});

it("picks the client from the same list invoices use, and sends it", async () => {
  vi.mocked(financeApi.listFinClients).mockResolvedValue([client()]);
  vi.mocked(financeApi.createFinEntry).mockResolvedValue({ ...entry, id: 4, entryNo: "INC-000004", amount: 250, party: "Al Noor Contracting" });
  const user = userEvent.setup();
  render(<MemoryRouter><IncomePage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add income" }));
  const dialog = await screen.findByRole("dialog");

  await user.selectOptions(await within(dialog).findByLabelText("Client (optional)"), "12");
  expect(within(dialog).getByLabelText("Received from")).toHaveValue("Al Noor Contracting");
  await user.type(within(dialog).getByLabelText("Amount (AED)"), "250");
  await user.selectOptions(within(dialog).getByLabelText("Category"), "10");
  await user.selectOptions(within(dialog).getByLabelText("Received into"), "1");
  await user.click(within(dialog).getByRole("button", { name: "Save income" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalledWith("Income", expect.objectContaining({ clientId: 12, party: "Al Noor Contracting" })));
  expect(financeApi.listFinPayees).not.toHaveBeenCalledWith("Income");
});

it("warns when the client still owes on invoices, whether picked or typed", async () => {
  vi.mocked(financeApi.listFinClients).mockResolvedValue([client({ unpaid: 186921, unpaidInvoices: ["INV-000189", "INV-000191"] }), client({ id: 13, name: "Paid Up LLC" })]);
  const user = userEvent.setup();
  render(<MemoryRouter><IncomePage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add income" }));
  const dialog = await screen.findByRole("dialog");
  const picker = await within(dialog).findByLabelText("Client (optional)");
  expect(within(dialog).queryByText(/still owes/)).not.toBeInTheDocument();

  await user.selectOptions(picker, "12");
  const warning = within(dialog).getByRole("status", { name: "Unpaid invoices" });
  expect(warning).toHaveTextContent("Al Noor Contracting still owes AED 186,921.00 on INV-000189, INV-000191.");
  expect(warning).toHaveTextContent("record it on the invoice instead");
  expect(within(warning).getByRole("link", { name: "Go to Tax Invoices" })).toHaveAttribute("href", "/invoices");

  await user.selectOptions(picker, "13");
  expect(within(dialog).queryByRole("status", { name: "Unpaid invoices" })).not.toBeInTheDocument();

  const from = within(dialog).getByLabelText("Received from");
  await user.clear(from);
  await user.type(from, "  al noor contracting ");
  expect(within(dialog).getByRole("status", { name: "Unpaid invoices" })).toBeInTheDocument();
});

it("gives the Partner no add button", async () => {
  signIn("Viewer");
  render(<MemoryRouter><IncomePage /></MemoryRouter>);
  await screen.findAllByText("111,767.04");
  expect(screen.queryByRole("button", { name: "Add income" })).not.toBeInTheDocument();
});

it("marks a payment recorded on a tax invoice, and offers no Correct or Void on it", async () => {
  vi.mocked(financeApi.listFinEntries).mockResolvedValue({ items: [{ ...entry, party: "Acme Glass LLC", invoiceId: 7 }, { ...entry, id: 4, entryNo: "INC-000004", party: "Walk-in" }], total: 1, count: 2, truncated: false });
  render(<MemoryRouter><IncomePage /></MemoryRouter>);

  expect((await screen.findAllByText("Payment on a tax invoice")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Correct INC-000003" })).not.toBeInTheDocument();     // changed on the invoice, so the books and the invoice never disagree
  expect(screen.queryByRole("button", { name: "Void INC-000003" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Correct INC-000004" }).length).toBeGreaterThan(0);  // an ordinary income keeps its tools
  expect(screen.getByText(/recorded as a payment on a tax invoice/)).toBeInTheDocument();
});
