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

it("includes staff custody money in the cash subtotal", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account(), cash, { ...cash, id: 4, name: "Staff custody", kind: "Custody", balance: 1500 }]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  const panel = await screen.findByRole("region", { name: "Total balance" });
  expect(within(panel).getByText(/1,849.75/)).toBeInTheDocument();
  expect(within(panel).getByText("3,000.00")).toBeInTheDocument();
});

it("lets a Manager add an account, transfer and switch accounts off", async () => {
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("1,500.00");

  expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Transfer" }).length).toBeGreaterThan(0);
  await userEvent.setup().click(screen.getByRole("button", { name: "More actions for Main cash" }));
  expect(screen.getByRole("menuitem", { name: "Edit details" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Deactivate account" })).toBeInTheDocument();
});

it("gives the read-only Partner the figures but no way to change anything", async () => {
  signIn("Viewer");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account({ accountNumber: "••••8001" }), cash]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText("1,500.00")).toBeInTheDocument();
  expect(screen.getByText("••••8001")).toBeInTheDocument();
  expect(screen.queryByText("0353713938001")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "More actions for Main cash" }));
  await user.click(screen.getByRole("menuitem", { name: "Deactivate account" }));
  await user.click(await screen.findByRole("button", { name: "Deactivate account" }));

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
  await user.click(await screen.findByRole("button", { name: "Void transfer TRF-000007" }));
  const dialog = await screen.findByRole("dialog");

  expect(within(dialog).getByRole("button", { name: "Void" })).toBeDisabled();
  await user.type(within(dialog).getByLabelText("Reason"), "no");
  expect(within(dialog).getByRole("button", { name: "Void" })).toBeDisabled();
  await user.clear(within(dialog).getByLabelText("Reason"));
  await user.type(within(dialog).getByLabelText("Reason"), "Cancelled by bank");
  await user.click(within(dialog).getByRole("button", { name: "Void" }));

  await waitFor(() => expect(financeApi.voidFinTransfer).toHaveBeenCalledWith(7, "Cancelled by bank"));
  expect(await screen.findByText("TRF-000007 was voided.")).toBeInTheDocument();
});

it("gives the Partner no void button on transfers", async () => {
  signIn("Viewer");
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await screen.findByText("TRF-000007");
  expect(screen.queryByRole("button", { name: /Void transfer/ })).not.toBeInTheDocument();
});

it("masks the IBAN until asked, and copies the whole of it", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account({ iban: "AE070331234567890123456" }), cash]);
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  const rak = await screen.findByRole("article", { name: "RAKBANK Current" });

  expect(within(rak).getByText("AE07 •••• 3456")).toBeInTheDocument();
  await user.click(within(rak).getByRole("button", { name: "Show IBAN of RAKBANK Current" }));
  expect(within(rak).getByText("AE070331234567890123456")).toBeInTheDocument();
  await user.click(within(rak).getByRole("button", { name: "Copy IBAN of RAKBANK Current" }));
  expect(await within(rak).findByText("IBAN copied")).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe("AE070331234567890123456");
});

it("says how many cheques are pending and what the balance will be, with a way to see them", async () => {
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account({ unclearedCheques: 100, bankBalance: 1250.25 }), cash]);
  vi.mocked(financeApi.listFinCheques).mockResolvedValue({ items: [{ id: 1, accountId: 1, entryId: 5 }], count: 1, openIssued: 100, openReceived: 0, truncated: false } as unknown as Awaited<ReturnType<typeof financeApi.listFinCheques>>);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  const rak = await screen.findByRole("article", { name: "RAKBANK Current" });

  const notice = within(rak).getByRole("status");
  expect(notice).toHaveTextContent("1 cheque pending · AED 100.00 not yet cleared. Expected balance after clearing: AED 1,150.25.");
  expect(within(rak).getByRole("link", { name: "View cheques" })).toHaveAttribute("href", "/finance/cheques");
});

it("shows a voided transfer as voided, struck through and with no button", async () => {
  vi.mocked(financeApi.listFinTransfers).mockResolvedValue([{ ...transfer, status: "Voided", voidReason: "Twice" }]);
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);

  expect(await screen.findByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("400.00")).toHaveClass("line-through");
  expect(screen.queryByRole("button", { name: /Void transfer/ })).not.toBeInTheDocument();
  expect(financeApi.listFinTransfers).toHaveBeenCalledWith(true);
});

it("gives focus back to the button that opened a dialog", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  const opener = await screen.findByRole("button", { name: "Void transfer TRF-000007" });

  await user.click(opener);
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

  expect(opener).toHaveFocus();
});
