import { render, screen, waitFor, within } from "@testing-library/react";
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
  createdBy: "m", createdUtc: "2026-11-20T08:00:00Z", attachments: [{ id: 5, fileName: "permit.pdf", contentType: "application/pdf", sizeBytes: 2048 }], ...over,
});

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account]);
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
  vi.mocked(financeApi.listFinExpenseParties).mockResolvedValue(["Royal Palm Business Center"]);
  vi.mocked(financeApi.listFinExpenses).mockResolvedValue({ items: [entry(), entry({ id: 2, entryNo: "EXP-000002", party: "Dubai Insurance", amount: 40, attachments: [] })], total: 515.65, count: 2, truncated: false });
});

it("shows the server's total and each expense with its receipt button", async () => {
  render(<ExpensesPage />);

  expect(await screen.findByText("515.65")).toBeInTheDocument();
  expect(screen.getByText("Royal Palm Business Center")).toBeInTheDocument();
  expect(screen.getByText("EXP-000001")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View receipt for EXP-000001" })).toBeInTheDocument();
  expect(screen.getByText("No receipt")).toBeInTheDocument();
});

it("asks the server again, with the filter, when a category is chosen", async () => {
  const user = userEvent.setup();
  render(<ExpensesPage />);
  await screen.findByText("515.65");

  await user.click(screen.getByRole("button", { name: /Filters/ }));
  await user.selectOptions(screen.getByLabelText("Category"), "1");

  await waitFor(() => expect(financeApi.listFinExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 1 })));
  expect(screen.getByRole("button", { name: /Filters \(1\)/ })).toBeInTheDocument();
});

it("searches after the person stops typing", async () => {
  const user = userEvent.setup();
  render(<ExpensesPage />);
  await screen.findByText("515.65");

  await user.type(screen.getByPlaceholderText(/search paid to/i), "palm");

  await waitFor(() => expect(financeApi.listFinExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ q: "palm" })));
});

it("starts on this month and can switch to all time", async () => {
  const user = userEvent.setup();
  render(<ExpensesPage />);
  await screen.findByText("515.65");
  expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "All time" }));

  await waitFor(() => expect(financeApi.listFinExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ from: undefined, to: undefined })));
});

it("lets a Manager add an expense but gives the Partner no button", async () => {
  const { unmount } = render(<ExpensesPage />);
  expect(await screen.findByRole("button", { name: "Add expense" })).toBeInTheDocument();
  unmount();

  signIn("Viewer");
  render(<ExpensesPage />);
  await screen.findByText("515.65");
  expect(screen.queryByRole("button", { name: "Add expense" })).not.toBeInTheDocument();
});

it("refuses to save an expense without a receipt, before it reaches the server", async () => {
  const user = userEvent.setup();
  render(<ExpensesPage />);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Amount (AED)"), "20");
  await user.click(within(dialog).getByRole("button", { name: "Save expense" }));

  expect(await within(dialog).findByText("Attach the receipt or supplier invoice.")).toBeInTheDocument();
  expect(within(dialog).getByText("Choose a category.")).toBeInTheDocument();
  expect(within(dialog).getByText("Enter who was paid.")).toBeInTheDocument();
  expect(financeApi.createFinExpense).not.toHaveBeenCalled();
});

it("saves an expense with its receipt and shows the new number", async () => {
  vi.mocked(financeApi.createFinExpense).mockResolvedValue(entry({ id: 9, entryNo: "EXP-000009", amount: 20, party: "Cafe" }));
  const user = userEvent.setup();
  render(<ExpensesPage />);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Amount (AED)"), "20");
  await user.selectOptions(within(dialog).getByLabelText("Category"), "1");
  await user.selectOptions(within(dialog).getByLabelText("Paid from"), "1");
  await user.type(within(dialog).getByLabelText("Paid to"), "Cafe");
  const receipt = new File([new Uint8Array(10)], "till.pdf", { type: "application/pdf" });
  await user.upload(dialog.querySelector('input[type="file"][multiple]') as HTMLInputElement, receipt);
  await user.click(within(dialog).getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(financeApi.createFinExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 20, categoryId: 1, accountId: 1, party: "Cafe", files: [receipt] })));
  expect(await screen.findByText(/EXP-000009: AED 20.00 paid to Cafe/)).toBeInTheDocument();
});

it("rejects a text file as a receipt on the spot", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<ExpensesPage />);
  await user.click(await screen.findByRole("button", { name: "Add expense" }));
  const dialog = await screen.findByRole("dialog");

  await user.upload(dialog.querySelector('input[type="file"][multiple]') as HTMLInputElement, new File(["hi"], "notes.txt", { type: "text/plain" }));

  expect(await within(dialog).findByText(/notes\.txt: attach a PDF, JPEG or PNG/)).toBeInTheDocument();
});

it("shows the server's field message under the field", async () => {
  vi.mocked(financeApi.createFinExpense).mockRejectedValue(new ApiError(400, "Invalid", undefined, undefined, { entryDate: ["RAKBANK Current opens on 1 Jun 2026. The date cannot be earlier."] }));
  const user = userEvent.setup();
  render(<ExpensesPage />);
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
  render(<ExpensesPage />);

  await user.click(await screen.findByRole("button", { name: "View receipt for EXP-000001" }));

  expect(await screen.findByTitle(/Receipt 1, permit\.pdf/)).toBeInTheDocument();
  expect(financeApi.getFinReceipt).toHaveBeenCalledWith(5);
});

it("explains an empty period and offers a retry on failure", async () => {
  vi.mocked(financeApi.listFinExpenses).mockResolvedValueOnce({ items: [], total: 0, count: 0, truncated: false });
  const { unmount } = render(<ExpensesPage />);
  expect(await screen.findByText("No expenses match")).toBeInTheDocument();
  unmount();

  vi.mocked(financeApi.listFinExpenses).mockRejectedValueOnce(new ApiError(500, "The server had a problem."));
  render(<ExpensesPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
