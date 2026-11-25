import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCategory, FinEntry } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { IncomePage } from "./IncomePage";

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

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account]);
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
  vi.mocked(financeApi.listFinParties).mockResolvedValue([]);
  vi.mocked(financeApi.listFinEntries).mockResolvedValue({ items: [entry], total: 111767.04, count: 1, truncated: false });
});

it("lists income with its own wording and asks the server for income", async () => {
  render(<IncomePage />);

  expect((await screen.findAllByText("111,767.04")).length).toBe(2); // the total and the row
  expect(screen.getByRole("heading", { name: "Income" })).toBeInTheDocument();
  expect(screen.getByText("Total received", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("Received from")).toBeInTheDocument();
  expect(screen.getByText("One by Binghatti")).toBeInTheDocument();
  expect(financeApi.listFinEntries).toHaveBeenCalledWith("Income", expect.anything());
});

it("offers only income categories when adding", async () => {
  const user = userEvent.setup();
  render(<IncomePage />);
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
  render(<IncomePage />);
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

it("gives the Partner no add button", async () => {
  signIn("Viewer");
  render(<IncomePage />);
  await screen.findAllByText("111,767.04");
  expect(screen.queryByRole("button", { name: "Add income" })).not.toBeInTheDocument();
});
