import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCategory, FinEntry } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { ExpensesPage } from "./ExpensesPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const account: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-06-01", isActive: true, sortOrder: 0, balance: 900, entryCount: 2 };
const categories: FinCategory[] = [
  { id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 2 },
  { id: 10, kind: "Income", name: "Other income", isActive: true, useCount: 0 },
];
const entry = (over: Partial<FinEntry> = {}): FinEntry => ({
  id: 1, kind: "Expense", entryNo: "EXP-000001", entryDate: "2026-11-20", categoryId: 1, categoryName: "Company expenses", party: "Royal Palm Business Center",
  accountId: 1, accountName: "RAKBANK Current", amount: 475.65, reference: "IN2630722", notes: "Entry permit", status: "Active", voidReason: null,
  createdBy: "m", createdUtc: "2026-11-20T08:00:00Z", attachments: [{ id: 5, fileName: "permit.pdf", contentType: "application/pdf", sizeBytes: 2048 }],
  voidedBy: null, voidedUtc: null, replacesEntryId: null, replacesEntryNo: null, replacedByEntryNo: null, ...over,
});

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account]);
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
  vi.mocked(financeApi.listFinParties).mockResolvedValue(["Royal Palm Business Center"]);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([]);
  vi.mocked(financeApi.listFinTaxTypes).mockResolvedValue([]);
  vi.mocked(financeApi.listFinEntries).mockResolvedValue({ items: [entry(), entry({ id: 2, entryNo: "EXP-000002", party: "Dubai Insurance", amount: 40, attachments: [] })], total: 515.65, count: 2, truncated: false });
});

it("shows the server's total and each expense with its receipt button", async () => {
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);

  expect(await screen.findByText("515.65")).toBeInTheDocument();
  expect(screen.getByText("Royal Palm Business Center")).toBeInTheDocument();
  expect(screen.getByText("EXP-000001")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View receipt for EXP-000001" })).toBeInTheDocument();
  expect(screen.getByText("No receipt")).toBeInTheDocument();
});

it("asks the server again, with the filter, when a category is chosen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await screen.findByText("515.65");

  await user.click(screen.getByRole("button", { name: /Filters/ }));
  await user.selectOptions(screen.getByLabelText("Category"), "1");

  await waitFor(() => expect(financeApi.listFinEntries).toHaveBeenLastCalledWith("Expense", expect.objectContaining({ categoryId: 1 })));
  expect(screen.getByRole("button", { name: /Filters \(1\)/ })).toBeInTheDocument();
});

it("searches after the person stops typing", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await screen.findByText("515.65");

  await user.type(screen.getByPlaceholderText(/search paid to/i), "palm");

  await waitFor(() => expect(financeApi.listFinEntries).toHaveBeenLastCalledWith("Expense", expect.objectContaining({ q: "palm" })));
});

it("starts on this month and can switch to all time", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await screen.findByText("515.65");
  expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "All time" }));

  await waitFor(() => expect(financeApi.listFinEntries).toHaveBeenLastCalledWith("Expense", expect.objectContaining({ from: undefined, to: undefined })));
});

it("lets a Manager add an expense but gives the Partner no button", async () => {
  const { unmount } = render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Add expense" })).toBeInTheDocument();
  unmount();

  signIn("Viewer");
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await screen.findByText("515.65");
  expect(screen.queryByRole("button", { name: "Add expense" })).not.toBeInTheDocument();
});

it("refuses to save an expense without a receipt, before it reaches the server", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Amount (AED)"), "20");
  await user.click(within(dialog).getByRole("button", { name: "Save expense" }));

  expect(await within(dialog).findByText("Attach the receipt or supplier invoice.")).toBeInTheDocument();
  expect(within(dialog).getByText("Choose a category.")).toBeInTheDocument();
  expect(within(dialog).getByText("Enter who was paid.")).toBeInTheDocument();
  expect(financeApi.createFinEntry).not.toHaveBeenCalled();
});

it("saves an expense with its receipt and shows the new number", async () => {
  vi.mocked(financeApi.createFinEntry).mockResolvedValue(entry({ id: 9, entryNo: "EXP-000009", amount: 20, party: "Cafe" }));
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Amount (AED)"), "20");
  await user.selectOptions(within(dialog).getByLabelText("Category"), "1");
  await user.selectOptions(within(dialog).getByLabelText("Paid from"), "1");
  await user.type(within(dialog).getByLabelText("Paid to"), "Cafe");
  const receipt = new File([new Uint8Array(10)], "till.pdf", { type: "application/pdf" });
  await user.upload(dialog.querySelector('input[type="file"][multiple]') as HTMLInputElement, receipt);
  await user.click(within(dialog).getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(financeApi.createFinEntry).toHaveBeenCalledWith("Expense", expect.objectContaining({ amount: 20, categoryId: 1, accountId: 1, party: "Cafe", files: [receipt] })));
  expect(await screen.findByText(/EXP-000009: AED 20.00 paid to Cafe/)).toBeInTheDocument();
});

it("rejects a text file as a receipt on the spot", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.upload(dialog.querySelector('input[type="file"][multiple]') as HTMLInputElement, new File(["hi"], "notes.txt", { type: "text/plain" }));

  expect(await within(dialog).findByText(/notes\.txt: attach a PDF, JPEG or PNG/)).toBeInTheDocument();
});

it("shows the server's field message under the field", async () => {
  vi.mocked(financeApi.createFinEntry).mockRejectedValue(new ApiError(400, "Invalid", undefined, undefined, { entryDate: ["RAKBANK Current opens on 1 Jun 2026. The date cannot be earlier."] }));
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Amount (AED)"), "20");
  await user.selectOptions(within(dialog).getByLabelText("Category"), "1");
  await user.selectOptions(within(dialog).getByLabelText("Paid from"), "1");
  await user.type(within(dialog).getByLabelText("Paid to"), "Cafe");
  await user.upload(dialog.querySelector('input[type="file"][multiple]') as HTMLInputElement, new File([new Uint8Array(10)], "t.pdf", { type: "application/pdf" }));
  await user.click(within(dialog).getByRole("button", { name: "Save expense" }));

  expect(await within(dialog).findByText(/opens on 1 Jun 2026/)).toBeInTheDocument();
});

it("opens a receipt in a dialog", async () => {
  vi.mocked(financeApi.getFinReceipt).mockResolvedValue(new Blob(["%PDF-"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn(() => "blob:receipt");
  URL.revokeObjectURL = vi.fn();
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);

  await user.click(await screen.findByRole("button", { name: "View receipt for EXP-000001" }));

  expect(await screen.findByTitle(/Receipt 1, permit\.pdf/)).toBeInTheDocument();
  expect(financeApi.getFinReceipt).toHaveBeenCalledWith(5, false);
});

it("explains an empty period and offers a retry on failure", async () => {
  vi.mocked(financeApi.listFinEntries).mockResolvedValueOnce({ items: [], total: 0, count: 0, truncated: false });
  const { unmount } = render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  expect(await screen.findByText("No expenses match")).toBeInTheDocument();
  unmount();

  vi.mocked(financeApi.listFinEntries).mockRejectedValueOnce(new ApiError(500, "The server had a problem."));
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

// --- void, correct, lock ---------------------------------------------------------------------------------

it("voids an expense only with a reason, then reloads", async () => {
  vi.mocked(financeApi.voidFinEntry).mockResolvedValue(entry({ status: "Voided", voidReason: "Entered twice" }));
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Void EXP-000001" }));
  const dialog = await screen.findByRole("dialog");

  await user.click(within(dialog).getByRole("button", { name: "Void" }));
  expect(await within(dialog).findByText(/enter the reason/i)).toBeInTheDocument();
  expect(financeApi.voidFinEntry).not.toHaveBeenCalled();

  await user.type(within(dialog).getByLabelText("Reason"), "Entered twice");
  await user.click(within(dialog).getByRole("button", { name: "Void" }));

  await waitFor(() => expect(financeApi.voidFinEntry).toHaveBeenCalledWith("Expense", 1, "Entered twice"));
  expect(await screen.findByText("EXP-000001 was voided.")).toBeInTheDocument();
});

it("shows the server's reason in the dialog when a void is refused", async () => {
  vi.mocked(financeApi.voidFinEntry).mockRejectedValue(new ApiError(409, "November 2026 is locked (by manager1 on 24 Nov 2026)."));
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Void EXP-000001" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Reason"), "Wrong");
  await user.click(within(dialog).getByRole("button", { name: "Void" }));

  expect(await within(dialog).findByText(/is locked/)).toBeInTheDocument();
});

it("corrects an expense: the form opens filled in, receipts can be kept, and the replacement is announced", async () => {
  vi.mocked(financeApi.correctFinEntry).mockResolvedValue(entry({ id: 12, entryNo: "EXP-000012", amount: 480, replacesEntryId: 1, replacesEntryNo: "EXP-000001" }));
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Correct EXP-000001" }));
  const dialog = await screen.findByRole("dialog");

  expect(within(dialog).getByLabelText("Amount (AED)")).toHaveValue("475.65");
  expect(within(dialog).getByLabelText("Paid to")).toHaveValue("Royal Palm Business Center");
  expect(within(dialog).getByText(/EXP-000001 will be voided and kept/)).toBeInTheDocument();
  const amount = within(dialog).getByLabelText("Amount (AED)");
  await user.clear(amount);
  await user.type(amount, "480");
  await user.click(within(dialog).getByRole("button", { name: "Save correction" }));

  await waitFor(() => expect(financeApi.correctFinEntry).toHaveBeenCalledWith("Expense", 1, expect.objectContaining({ amount: 480, keepAttachmentIds: [5], files: [] })));
  expect(await screen.findByText("EXP-000001 was voided and replaced by EXP-000012.")).toBeInTheDocument();
});

it("refuses a correction that would leave the expense with no receipt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Correct EXP-000001" }));
  const dialog = await screen.findByRole("dialog");

  await user.click(within(dialog).getByLabelText(/Keep permit\.pdf/));
  await user.click(within(dialog).getByRole("button", { name: "Save correction" }));

  expect(await within(dialog).findByText("Attach the receipt or supplier invoice.")).toBeInTheDocument();
  expect(financeApi.correctFinEntry).not.toHaveBeenCalled();
});

it("shows voided rows only on request, with the word Voided and the reason, and no actions", async () => {
  const voided = entry({ id: 3, entryNo: "EXP-000003", party: "Mistaken Ltd", status: "Voided", voidReason: "Entered twice", voidedBy: "manager1", replacedByEntryNo: "EXP-000004" });
  vi.mocked(financeApi.listFinEntries).mockResolvedValue({ items: [voided], total: 0, count: 0, truncated: false });
  const user = userEvent.setup();
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);

  await user.click(await screen.findByLabelText(/Show voided expenses/));

  await waitFor(() => expect(financeApi.listFinEntries).toHaveBeenLastCalledWith("Expense", expect.objectContaining({ includeVoided: true })));
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText(/manager1: Entered twice/)).toBeInTheDocument();
  expect(screen.getByText("Replaced by EXP-000004")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Void EXP-000003" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Correct EXP-000003" })).not.toBeInTheDocument();
});

it("takes the change buttons away from an expense in a locked month and says why", async () => {
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([{ month: "2026-11", isLocked: true, lockedBy: "manager1", lockedUtc: "2026-11-24T08:00:00Z", unlockedBy: null, unlockedUtc: null, unlockReason: null }]);
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);

  expect((await screen.findAllByText("Locked month")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Void EXP-000001" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Correct EXP-000001" })).not.toBeInTheDocument();
});

it("gives the Partner no void or correct buttons", async () => {
  signIn("Viewer");
  render(<MemoryRouter><ExpensesPage /></MemoryRouter>);
  await screen.findByText("EXP-000001");
  expect(screen.queryByRole("button", { name: /^(Void|Correct) / })).not.toBeInTheDocument();
});
