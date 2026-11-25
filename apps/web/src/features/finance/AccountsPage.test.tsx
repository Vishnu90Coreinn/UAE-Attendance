import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinTransfer } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { AccountsPage } from "./AccountsPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

function account(overrides: Partial<FinAccount> = {}): FinAccount {
  return {
    id: 1, name: "RAKBANK Current", kind: "Bank", bankName: "RAKBANK", accountNumber: "0353713938001", iban: null,
    openingBalance: 1000, openingDate: "2026-08-05", isActive: true, sortOrder: 0, balance: 1150.25, entryCount: 3, ...overrides,
  };
}
const cash = account({ id: 2, name: "Main cash", kind: "Cash", bankName: null, accountNumber: null, openingBalance: 0, balance: 349.75, entryCount: 1 });
const transfer: FinTransfer = {
  id: 7, transferNo: "TRF-000007", transferDate: "2026-11-20", fromAccountId: 1, fromAccountName: "RAKBANK Current", toAccountId: 2, toAccountName: "Main cash",
  amount: 400, reference: "CHQ 12", notes: null, status: "Active", voidReason: null, createdBy: "m", createdUtc: "2026-11-20T08:00:00Z",
};

function signIn(role: "Manager" | "Viewer" | "Administrator") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account(), cash]);
  vi.mocked(financeApi.listFinTransfers).mockResolvedValue([transfer]);
});

it("shows the total balance, each account with its balance, and the recent transfers", async () => {
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText("1,500.00")).toBeInTheDocument(); // 1150.25 + 349.75
  const rak = screen.getByRole("article", { name: "RAKBANK Current" });
  expect(within(rak).getByText("1,150.25")).toBeInTheDocument();
  expect(within(rak).getByText("0353713938001")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Main cash" })).getByText("349.75")).toBeInTheDocument();
  expect(screen.getByText("TRF-000007")).toBeInTheDocument();
  expect(screen.getByText("CHQ 12")).toBeInTheDocument();
});

it("lets a Manager add an account, transfer and switch accounts off", async () => {
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Transfer" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Edit RAKBANK Current" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch off Main cash" })).toBeInTheDocument();
});

it("gives the read-only Partner the figures but no way to change anything", async () => {
  signIn("Viewer");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account({ accountNumber: "••••8001" }), cash]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText("1,500.00")).toBeInTheDocument();
  expect(screen.getByText("••••8001")).toBeInTheDocument();
  expect(screen.queryByText("0353713938001")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Switch off/ })).not.toBeInTheDocument();
});

it("explains an empty page and, for a Manager, offers the first account", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTransfers).mockResolvedValue([]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add the first account" })).toBeInTheDocument();
});

it("tells a Partner who sees no accounts that a Manager adds them", async () => {
  signIn("Viewer");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTransfers).mockResolvedValue([]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText(/a manager adds the company's accounts/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
});

it("marks an overdrawn account with a word, not just a colour", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account({ balance: -50.75 }), cash]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  const rak = await screen.findByRole("article", { name: "RAKBANK Current" });
  expect(within(rak).getByText("Overdrawn")).toBeInTheDocument();
  expect(within(rak).getByText("-50.75")).toBeInTheDocument();
});

it("shows a retry when the accounts cannot be loaded", async () => {
  vi.mocked(financeApi.listFinAccounts).mockRejectedValueOnce(new ApiError(500, "The server had a problem."));
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("1,500.00")).toBeInTheDocument();
});

it("shows the server's reason when an account still holding money is switched off", async () => {
  vi.mocked(financeApi.setFinAccountActive).mockRejectedValue(new ApiError(409, "This account still holds AED 349.75. Transfer or record the remaining amount first."));
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  await user.click(screen.getByRole("button", { name: "Switch off Main cash" }));
  await user.click(await screen.findByRole("button", { name: "Switch off", hidden: false }));

  expect(await screen.findByRole("alert")).toHaveTextContent("still holds AED 349.75");
});

it("shows a field message from the server under the account name", async () => {
  vi.mocked(financeApi.createFinAccount).mockRejectedValue(new ApiError(400, "Invalid", undefined, undefined, { name: ["An account with this name already exists."] }));
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  await user.click(screen.getByRole("button", { name: "Add account" }));
  await user.type(await screen.findByLabelText("Account name"), "RAKBANK Current");
  await user.type(screen.getByLabelText("Opening balance (AED)"), "0");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add account" }));

  expect(await screen.findByText("An account with this name already exists.")).toBeInTheDocument();
});

it("refuses a transfer to the same account before it reaches the server", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  await user.click(screen.getAllByRole("button", { name: "Transfer" })[0]);
  const dialog = await screen.findByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("From account"), "1");
  await user.type(within(dialog).getByLabelText("Amount (AED)"), "10");
  await user.click(within(dialog).getByRole("button", { name: "Transfer" }));

  expect(await within(dialog).findByText(/choose the account the money goes to/i)).toBeInTheDocument();
  expect(financeApi.createFinTransfer).not.toHaveBeenCalled();
});

it("sends a valid transfer and shows its number", async () => {
  vi.mocked(financeApi.createFinTransfer).mockResolvedValue({ ...transfer, id: 8, transferNo: "TRF-000008", amount: 25.5 });
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  await user.click(screen.getAllByRole("button", { name: "Transfer" })[0]);
  const dialog = await screen.findByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("From account"), "1");
  await user.selectOptions(within(dialog).getByLabelText("To account"), "2");
  await user.type(within(dialog).getByLabelText("Amount (AED)"), "25.50");
  await user.click(within(dialog).getByRole("button", { name: "Transfer" }));

  await waitFor(() => expect(financeApi.createFinTransfer).toHaveBeenCalledWith(expect.objectContaining({ fromAccountId: 1, toAccountId: 2, amount: 25.5 })));
  expect(await screen.findByText(/TRF-000008: AED 25.50 moved/)).toBeInTheDocument();
});

it("voids a transfer with a reason and shows the confirmation", async () => {
  vi.mocked(financeApi.voidFinTransfer).mockResolvedValue({ ...transfer, status: "Voided", voidReason: "Cancelled by bank" });
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Void TRF-000007" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Reason"), "Cancelled by bank");
  await user.click(within(dialog).getByRole("button", { name: "Void" }));

  await waitFor(() => expect(financeApi.voidFinTransfer).toHaveBeenCalledWith(7, "Cancelled by bank"));
  expect(await screen.findByText("TRF-000007 was voided.")).toBeInTheDocument();
});

it("gives the Partner no void button on transfers", async () => {
  signIn("Viewer");
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("TRF-000007");
  expect(screen.queryByRole("button", { name: /Void TRF/ })).not.toBeInTheDocument();
});
