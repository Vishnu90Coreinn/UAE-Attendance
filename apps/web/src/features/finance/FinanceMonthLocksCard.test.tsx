import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { ApiError } from "../../api/client";
import { FinanceMonthLocksCard } from "./FinanceMonthLocksCard";

vi.mock("../../api/finance");

const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" }).format(new Date());
const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const thisMonthLabel = `${names[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([]);
});

it("lists the last twelve months, all open to start with", async () => {
  render(<FinanceMonthLocksCard />);

  expect((await screen.findAllByText(thisMonthLabel)).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /^Lock [A-Z][a-z]+ \d{4}$/ })).toHaveLength(12);
});

it("locks a month", async () => {
  vi.mocked(financeApi.lockFinMonth).mockResolvedValue({ month, isLocked: true, lockedBy: "m", lockedUtc: "2026-11-24T08:00:00Z", unlockedBy: null, unlockedUtc: null, unlockReason: null });
  const user = userEvent.setup();
  render(<FinanceMonthLocksCard />);

  await user.click(await screen.findByRole("button", { name: `Lock ${thisMonthLabel}` }));

  await waitFor(() => expect(financeApi.lockFinMonth).toHaveBeenCalledWith(month));
});

it("shows who locked a month and unlocks it only with a reason", async () => {
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([{ month, isLocked: true, lockedBy: "manager1", lockedUtc: "2026-11-24T08:00:00Z", unlockedBy: null, unlockedUtc: null, unlockReason: null }]);
  vi.mocked(financeApi.unlockFinMonth).mockResolvedValue({ month, isLocked: false, lockedBy: "manager1", lockedUtc: null, unlockedBy: "manager1", unlockedUtc: "2026-11-25T08:00:00Z", unlockReason: "Missed invoice" });
  const user = userEvent.setup();
  render(<FinanceMonthLocksCard />);
  expect(await screen.findByText(/by manager1 on/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: `Unlock ${thisMonthLabel}` }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Unlock" }));
  expect(await within(dialog).findByText(/enter the reason/i)).toBeInTheDocument();
  expect(financeApi.unlockFinMonth).not.toHaveBeenCalled();

  await user.type(within(dialog).getByLabelText("Reason"), "Missed invoice");
  await user.click(within(dialog).getByRole("button", { name: "Unlock" }));

  await waitFor(() => expect(financeApi.unlockFinMonth).toHaveBeenCalledWith(month, "Missed invoice"));
});

it("shows the server's message when a lock is refused", async () => {
  vi.mocked(financeApi.lockFinMonth).mockRejectedValue(new ApiError(409, "This month is already locked."));
  const user = userEvent.setup();
  render(<FinanceMonthLocksCard />);
  await user.click(await screen.findByRole("button", { name: `Lock ${thisMonthLabel}` }));

  expect(await screen.findByRole("alert")).toHaveTextContent("already locked");
});

it("locks every month up to the one chosen, oldest first, after asking", async () => {
  const lockFor = (m: string) => ({ month: m, isLocked: true, lockedBy: "m", lockedUtc: "2026-11-24T08:00:00Z", unlockedBy: null, unlockedUtc: null, unlockReason: null });
  vi.mocked(financeApi.lockFinMonth).mockImplementation(async (m) => lockFor(m));
  const user = userEvent.setup();
  render(<FinanceMonthLocksCard />);

  await user.click(await screen.findByRole("button", { name: /^Lock 11 months$/ }));          // the month that just ended and the ten before it
  expect(financeApi.lockFinMonth).not.toHaveBeenCalled();                                     // it asks first
  await user.click(screen.getByRole("button", { name: /^Yes, lock 11 months$/ }));

  await waitFor(() => expect(financeApi.lockFinMonth).toHaveBeenCalledTimes(11));
  const asked = vi.mocked(financeApi.lockFinMonth).mock.calls.map((c) => c[0]);
  expect([...asked].sort()).toEqual(asked);                                                  // oldest first, so a failure leaves no gap
  expect(asked).not.toContain(month);                                                        // the current month is not finished, so it is left open
});

it("warns when a month is open although a later one is locked", async () => {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1);
  const key = (back: number) => `${Math.floor((idx - back) / 12)}-${String(((idx - back) % 12) + 1).padStart(2, "0")}`;
  vi.mocked(financeApi.listFinMonthLocks).mockResolvedValue([{ month: key(1), isLocked: true, lockedBy: "m", lockedUtc: "2026-11-24T08:00:00Z", unlockedBy: null, unlockedUtc: null, unlockReason: null }]);
  render(<FinanceMonthLocksCard />);

  expect(await screen.findByText(/Locked up to /)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/still open although .* is locked/);
});
