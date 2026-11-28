import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { LedgerAccount } from "../../api/finance";
import { MappingTab } from "./MappingTab";

vi.mock("../../api/finance");

const acc = (id: number, code: string, name: string, type: LedgerAccount["type"]) => ({ id, code, name, type, isActive: true, isSystem: false, debit: 0, credit: 0, balance: 0 }) as LedgerAccount;
const accounts = [acc(1, "1100", "RAKBANK Current Account", "Asset"), acc(2, "1110", "Main cash", "Asset"), acc(3, "1120", "Fatima petty cash", "Asset"), acc(4, "5000", "Company expenses", "Expense"), acc(5, "5010", "Rent", "Expense")];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.getLedgerMappings).mockResolvedValue([
    { kind: "Account", id: 1, name: "RAKBANK", detail: "Bank", ledgerAccountId: 1 },
    { kind: "Account", id: 2, name: "Main cash", detail: "Cash", ledgerAccountId: 2 },
    { kind: "Account", id: 3, name: "Fatima petty cash", detail: "Custody", ledgerAccountId: 3 },
    { kind: "Category", id: 7, name: "Office Rent", detail: "Expense", ledgerAccountId: 5 },
    { kind: "Category", id: 8, name: "Insurance", detail: "Expense", ledgerAccountId: 5 },
  ]);
});

it("offers a bank or cash account only the ledger accounts it can take, not ones another account already uses", async () => {
  render(<MappingTab accounts={accounts} canEdit onChanged={() => {}} />);

  const select = await screen.findByLabelText("Main cash posts to");
  const options = within(select).getAllByRole("option").map((o) => o.textContent);
  expect(options).toEqual(["1110 · Main cash"]);                      // 1100 and 1120 belong to other accounts, and the expense accounts are the wrong type
});

it("lets categories share an account, and says petty cash instead of the raw word Custody", async () => {
  render(<MappingTab accounts={accounts} canEdit onChanged={() => {}} />);

  const select = await screen.findByLabelText("Insurance posts to");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining(["5000 · Company expenses", "5010 · Rent"]));   // 5010 is shared with Office Rent, which is fine
  expect(screen.getByText("Petty cash")).toBeInTheDocument();
  expect(screen.queryByText("Custody")).not.toBeInTheDocument();
});
