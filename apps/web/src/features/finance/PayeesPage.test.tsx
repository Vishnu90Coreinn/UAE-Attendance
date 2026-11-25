import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinCategory, FinPayee } from "../../api/finance";
import { useAuth } from "../../contexts/AuthContext";
import { PayeesPage } from "./PayeesPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const categories: FinCategory[] = [
  { id: 5, kind: "Expense", name: "Worker Accommodation Rent", isActive: true, useCount: 0 },
  { id: 10, kind: "Income", name: "Other income", isActive: true, useCount: 0 },
];
const payee = (over: Partial<FinPayee> = {}): FinPayee => ({
  id: 1, kind: "Expense", name: "M S K Luxuries", defaultCategoryId: 5, defaultCategoryName: "Worker Accommodation Rent", phone: null, taxNumber: null, notes: null, isActive: true, entryCount: 2, total: 24000, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role: "Manager" }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
  vi.mocked(financeApi.listFinPayees).mockResolvedValue([payee(), payee({ id: 2, kind: "Income", name: "One by Binghatti", total: 111767.04, entryCount: 1, defaultCategoryId: 10, defaultCategoryName: "Other income" })]);
});

it("lists who was paid with the total for each, and who paid us on the other tab", async () => {
  const user = userEvent.setup();
  render(<PayeesPage />);

  expect(await screen.findByText("M S K Luxuries")).toBeInTheDocument();
  expect(screen.getByText("AED 24,000.00")).toBeInTheDocument();
  expect(screen.getByText("2 entries")).toBeInTheDocument();
  expect(screen.queryByText("One by Binghatti")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Received from" }));
  expect(screen.getByText("One by Binghatti")).toBeInTheDocument();
});

it("adds a payee with its usual category", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.createFinPayee).mockResolvedValue(payee({ id: 3, name: "Dubai Insurance" }));
  render(<PayeesPage />);

  await user.click(await screen.findByRole("button", { name: "Add payee" }));
  await user.type(screen.getByLabelText("Name"), "Dubai Insurance");
  await user.selectOptions(screen.getByLabelText("Usual category (optional)"), "5");
  const buttons = screen.getAllByRole("button", { name: "Add payee" });
  await user.click(buttons[buttons.length - 1]);

  await waitFor(() => expect(financeApi.createFinPayee).toHaveBeenCalledWith(expect.objectContaining({ kind: "Expense", name: "Dubai Insurance", defaultCategoryId: 5 })));
});

it("refuses an empty name on the spot", async () => {
  const user = userEvent.setup();
  render(<PayeesPage />);

  await user.click(await screen.findByRole("button", { name: "Add payee" }));
  const buttons = screen.getAllByRole("button", { name: "Add payee" });
  await user.click(buttons[buttons.length - 1]);

  expect(await screen.findByText("Enter the name.")).toBeInTheDocument();
  expect(financeApi.createFinPayee).not.toHaveBeenCalled();
});
