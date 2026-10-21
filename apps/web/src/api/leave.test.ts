import { beforeEach, expect, it, vi } from "vitest";
import { apiDelete, apiGet, apiPost } from "./client";
import {
  approveLeave,
  createLeave,
  deleteLeave,
  listLeave,
  rejectLeave,
} from "./leave";
vi.mock("./client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it("loads only the requested optional filters", async () => {
  await listLeave({ status: "Approved", workerId: 7 });
  expect(apiGet).toHaveBeenCalledWith("/api/leave?status=Approved&workerId=7");
  await listLeave({});
  expect(apiGet).toHaveBeenLastCalledWith("/api/leave");
});
it("sends leave inputs and all three actions through the authenticated client", async () => {
  const input = {
    workerId: 7,
    leaveType: "Annual Leave" as const,
    startDate: "2026-11-01",
    endDate: "2026-11-02",
  };
  await createLeave(input);
  expect(apiPost).toHaveBeenCalledWith("/api/leave", input);
  await approveLeave(8);
  expect(apiPost).toHaveBeenLastCalledWith("/api/leave/8/approve", undefined);
  await rejectLeave(8);
  expect(apiPost).toHaveBeenLastCalledWith("/api/leave/8/reject", undefined);
  await deleteLeave(8);
  expect(apiDelete).toHaveBeenCalledWith("/api/leave/8");
});
