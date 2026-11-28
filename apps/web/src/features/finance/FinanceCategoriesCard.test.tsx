import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinCategory } from "../../api/finance";
import { ApiError } from "../../api/client";
import { FinanceCategoriesCard } from "./FinanceCategoriesCard";

vi.mock("../../api/finance");

const categories: FinCategory[] = [
  { id: 1, kind: "Expense", name: "Company expenses", isActive: true, useCount: 191 },
  { id: 2, kind: "Expense", name: "Office Rent", isActive: false, useCount: 0 },
  { id: 10, kind: "Income", name: "Other income", isActive: true, useCount: 1 },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinCategories).mockResolvedValue(categories);
});

it("lists expense and income categories separately, with how often each is used", async () => {
  render(<FinanceCategoriesCard />);

  const expense = await screen.findByRole("region", { name: "Expense categories" });
  expect(within(expense).getByText("Company expenses")).toBeInTheDocument();
  expect(within(expense).getByText("191 entries")).toBeInTheDocument();
  expect(within(expense).getByText("Switched off")).toBeInTheDocument();
  const income = screen.getByRole("region", { name: "Income categories" });
  expect(within(income).getByText("Other income")).toBeInTheDocument();
  expect(within(income).getByText("1 entry")).toBeInTheDocument();
});

it("adds a category to the right list", async () => {
  vi.mocked(financeApi.createFinCategory).mockResolvedValue({ id: 11, kind: "Income", name: "Project payment", isActive: true, useCount: 0 });
  const user = userEvent.setup();
  render(<FinanceCategoriesCard />);
  await screen.findByRole("region", { name: "Income categories" });

  await user.type(screen.getByLabelText("Add income category"), "Project payment");
  await user.click(within(screen.getByRole("region", { name: "Income categories" })).getByRole("button", { name: "Add" }));

  expect(financeApi.createFinCategory).toHaveBeenCalledWith("Income", "Project payment");
  expect(await screen.findByText("Project payment")).toBeInTheDocument();
});

it("shows the server's message for a duplicate name", async () => {
  vi.mocked(financeApi.createFinCategory).mockRejectedValue(new ApiError(400, "Invalid", undefined, undefined, { name: ["This category already exists."] }));
  const user = userEvent.setup();
  render(<FinanceCategoriesCard />);
  await screen.findByRole("region", { name: "Expense categories" });

  await user.type(screen.getByLabelText("Add expense category"), "Company expenses");
  await user.click(within(screen.getByRole("region", { name: "Expense categories" })).getByRole("button", { name: "Add" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This category already exists.");
});

it("renames a category", async () => {
  vi.mocked(financeApi.updateFinCategory).mockResolvedValue({ ...categories[0], name: "General expenses" });
  const user = userEvent.setup();
  render(<FinanceCategoriesCard />);
  await user.click(await screen.findByRole("button", { name: "Rename Company expenses" }));
  const field = screen.getByLabelText("New name for Company expenses");
  await user.clear(field);
  await user.type(field, "General expenses");
  await user.click(screen.getByRole("button", { name: "Save name" }));

  expect(financeApi.updateFinCategory).toHaveBeenCalledWith(1, "General expenses", true);
  expect(await screen.findByText("General expenses")).toBeInTheDocument();
});

it("switches a category off and back on", async () => {
  vi.mocked(financeApi.updateFinCategory).mockResolvedValue({ ...categories[0], isActive: false });
  const user = userEvent.setup();
  render(<FinanceCategoriesCard />);
  await user.click(await screen.findByRole("button", { name: "Switch off Company expenses" }));

  expect(financeApi.updateFinCategory).toHaveBeenCalledWith(1, "Company expenses", false);
  expect(await screen.findByRole("button", { name: "Switch on Company expenses" })).toBeInTheDocument();
});
