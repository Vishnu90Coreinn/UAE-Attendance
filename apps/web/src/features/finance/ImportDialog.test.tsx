import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinImportResult } from "../../api/finance";
import { ImportDialog } from "./ImportDialog";

vi.mock("../../api/finance");

const good = { row: 2, date: "2026-09-25", party: "M S K Luxuries", category: "Office Rent", account: "RAKBANK", amount: 12000, reference: null, notes: null, status: "Ready" as const, problems: [] };
const bad = { row: 3, date: null, party: "Someone", category: null, account: null, amount: 10, reference: null, notes: null, status: "Error" as const, problems: ["The date is missing or not a date."] };
const result = (over: Partial<FinImportResult> = {}): FinImportResult => ({ rows: [good], ready: 1, duplicates: 0, errors: 0, readyTotal: 12000, imported: 0, ...over });
const file = () => new File(["x"], "daftra.xlsx");

beforeEach(() => vi.resetAllMocks());

it("checks the file, shows every row, and imports only when confirmed", async () => {
  const user = userEvent.setup();
  const onImported = vi.fn();
  vi.mocked(financeApi.runFinImport).mockResolvedValueOnce(result()).mockResolvedValueOnce(result({ imported: 1 }));
  render(<ImportDialog kind="Expense" variant="center" onClose={vi.fn()} onImported={onImported} />);

  await user.upload(screen.getByLabelText("Excel file"), file());

  expect(await screen.findByText("M S K Luxuries")).toBeInTheDocument();
  expect(financeApi.runFinImport).toHaveBeenCalledWith("Expense", expect.any(File), false);   // a preview saves nothing
  await user.click(screen.getByRole("button", { name: "Import 1 expense" }));
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(1));
  expect(financeApi.runFinImport).toHaveBeenLastCalledWith("Expense", expect.any(File), true);
});

it("will not import while any row has a problem, and says which", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.runFinImport).mockResolvedValue(result({ rows: [good, bad], ready: 1, errors: 1 }));
  render(<ImportDialog kind="Expense" variant="center" onClose={vi.fn()} onImported={vi.fn()} />);

  await user.upload(screen.getByLabelText("Excel file"), file());

  expect(await screen.findByText("The date is missing or not a date.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import 1 expense" })).toBeDisabled();
  expect(screen.getByText(/Nothing is imported until every row is right/)).toBeInTheDocument();
});

it("shows the server's message for a file it cannot read", async () => {
  const user = userEvent.setup();
  vi.mocked(financeApi.runFinImport).mockRejectedValue(new (await import("../../api/client")).ApiError(400, "Validation failed", undefined, undefined, { file: ["That file could not be read. Use an Excel .xlsx file."] }));
  render(<ImportDialog kind="Income" variant="center" onClose={vi.fn()} onImported={vi.fn()} />);

  await user.upload(screen.getByLabelText("Excel file"), file());

  expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
});
