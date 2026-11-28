import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../api/finance";
import { navItemsForRole } from "./navItems";
import { QuickSearch } from "./QuickSearch";

vi.mock("../api/finance");

const items = navItemsForRole("Manager");
const hit: financeApi.FinSearchHit = { type: "Expense", id: 28, number: "EXP-000028", name: "M S K Luxuries Properties", date: "2026-11-23", amount: 12000, status: "Active" };

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function show(records: boolean) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <QuickSearch items={items} records={records} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.searchFinance).mockResolvedValue({ hits: [hit] });
});

it("finds a record by name and opens its list on that record", async () => {
  const user = userEvent.setup();
  show(true);

  await user.type(screen.getByRole("combobox", { name: "Search screens" }), "msk");
  expect(await screen.findByText("M S K Luxuries Properties")).toBeInTheDocument();
  expect(screen.getByText(/Expense EXP-000028/)).toBeInTheDocument();
  expect(screen.getByText("12,000.00")).toBeInTheDocument();
  await user.keyboard("{Enter}");

  expect(screen.getByTestId("where")).toHaveTextContent("/finance/expenses?q=EXP-000028");
  expect(financeApi.searchFinance).toHaveBeenCalledTimes(1);          // one request for the word, not one per letter
});

it("never looks for records without finance access, or for a single letter", async () => {
  const user = userEvent.setup();
  const { unmount } = show(false);
  await user.type(screen.getByRole("combobox", { name: "Search screens" }), "msk");
  await new Promise((r) => setTimeout(r, 350));
  expect(financeApi.searchFinance).not.toHaveBeenCalled();
  unmount();

  show(true);
  await user.type(screen.getByRole("combobox", { name: "Search screens" }), "m");
  await new Promise((r) => setTimeout(r, 350));
  expect(financeApi.searchFinance).not.toHaveBeenCalled();
});

it("says when nothing matches, and carries on if the search fails", async () => {
  vi.mocked(financeApi.searchFinance).mockRejectedValue(new Error("down"));
  const user = userEvent.setup();
  show(true);

  await user.type(screen.getByRole("combobox", { name: "Search screens" }), "zzzz");

  await waitFor(() => expect(screen.getByText("Nothing matches.")).toBeInTheDocument());
});
