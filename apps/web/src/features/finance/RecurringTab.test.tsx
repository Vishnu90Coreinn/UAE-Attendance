import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { LedgerAccount, RecurringJournal } from "../../api/finance";
import { RecurringTab } from "./RecurringTab";

vi.mock("../../api/finance");

const account = (id: number, code: string, name: string, type: LedgerAccount["type"]) => ({ id, code, name, type, isActive: true, isSystem: false, debit: 0, credit: 0, balance: 0 }) as LedgerAccount;
const accounts = [account(1, "5310", "Insurance", "Expense"), account(2, "1700", "Prepaid expenses", "Asset")];
const template = (over: Partial<RecurringJournal> = {}): RecurringJournal => ({
  id: 1, description: "Spread annual insurance", dayOfMonth: 1, startMonth: "2026-09", endMonth: "2027-08", isActive: true, amount: 1000,
  lines: [{ accountCode: "5310", accountName: "Insurance", debit: 1000, credit: 0, memo: null }, { accountCode: "1700", accountName: "Prepaid expenses", debit: 0, credit: 1000, memo: null }],
  posted: 2, nextMonth: "2026-11", due: 1, createdBy: "m", stoppedBy: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listRecurringJournals).mockResolvedValue([template()]);
});

it("lists each monthly journal with what it posts, how many months are done, and how many are due", async () => {
  render(<RecurringTab accounts={accounts} canEdit variant="center" onChanged={() => {}} />);

  expect(await screen.findByText("Spread annual insurance")).toBeInTheDocument();
  expect(screen.getByText("2 months posted")).toBeInTheDocument();
  expect(screen.getByText("1 due now")).toBeInTheDocument();
  expect(screen.getByText(/Next: Nov 2026/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Post due months (1)" })).toBeEnabled();
});

it("posts the due months, and reports a month that was left because it is locked", async () => {
  vi.mocked(financeApi.postDueRecurringJournals).mockResolvedValue({ posted: 2, skipped: [{ id: 1, description: "Spread annual insurance", month: "2026-10", reason: "October 2026 is locked." }] });
  const onChanged = vi.fn();
  render(<RecurringTab accounts={accounts} canEdit variant="center" onChanged={onChanged} />);

  await userEvent.click(await screen.findByRole("button", { name: "Post due months (1)" }));

  expect(await screen.findByText("2 journals posted.")).toBeInTheDocument();
  expect(screen.getByText(/Oct 2026: October 2026 is locked/)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});

it("disables posting when nothing is due, and hides every button from someone who cannot edit", async () => {
  vi.mocked(financeApi.listRecurringJournals).mockResolvedValue([template({ due: 0 })]);
  const { unmount } = render(<RecurringTab accounts={accounts} canEdit variant="center" onChanged={() => {}} />);
  expect(await screen.findByRole("button", { name: "Post due months" })).toBeDisabled();
  unmount();

  render(<RecurringTab accounts={accounts} canEdit={false} variant="center" onChanged={() => {}} />);
  await screen.findByText("Spread annual insurance");
  expect(screen.queryByRole("button", { name: /Post due months/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Stop/ })).not.toBeInTheDocument();
});

it("sets up a monthly journal from balanced lines, a day, and a first month", async () => {
  vi.mocked(financeApi.createRecurringJournal).mockResolvedValue(template());
  render(<RecurringTab accounts={accounts} canEdit variant="center" onChanged={() => {}} />);

  await userEvent.click(await screen.findByRole("button", { name: "New monthly journal" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("What it is for"), "Spread annual insurance");
  await userEvent.selectOptions(within(dialog).getByLabelText("Line 1 account"), "1");
  await userEvent.type(within(dialog).getByLabelText("Line 1 debit"), "1000");
  await userEvent.selectOptions(within(dialog).getByLabelText("Line 2 account"), "2");
  await userEvent.type(within(dialog).getByLabelText("Line 2 credit"), "1000");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save monthly journal" }));

  await waitFor(() => expect(financeApi.createRecurringJournal).toHaveBeenCalledWith(expect.objectContaining({ description: "Spread annual insurance", dayOfMonth: 1, lines: [{ accountId: 1, debit: 1000, credit: undefined, memo: undefined }, { accountId: 2, debit: undefined, credit: 1000, memo: undefined }] })));
});

it("stops a monthly journal", async () => {
  vi.mocked(financeApi.stopRecurringJournal).mockResolvedValue(template({ isActive: false }));
  render(<RecurringTab accounts={accounts} canEdit variant="center" onChanged={() => {}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Stop Spread annual insurance" }));

  await waitFor(() => expect(financeApi.stopRecurringJournal).toHaveBeenCalledWith(1));
});
