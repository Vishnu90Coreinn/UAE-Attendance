import { beforeEach, expect, it, vi } from "vitest";
import { apiDelete, apiGet, apiPut } from "./client";
import { getAttendance, saveAttendance, deleteAttendance } from "./attendance";

vi.mock("./client", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it("loads the selected day", async () => {
  await getAttendance("2026-10-19");
  expect(apiGet).toHaveBeenCalledWith("/api/attendance?date=2026-10-19");
});
it("saves one atomic batch including explicit clears", async () => {
  const rows = [{ workerId: 1, status: null, basicHours: 0, overtimeHours: 0 }];
  await saveAttendance("2026-10-19", rows);
  expect(apiPut).toHaveBeenCalledWith("/api/attendance/2026-10-19", rows);
});
it("can remove a single record", async () => {
  await deleteAttendance("2026-10-19", 1);
  expect(apiDelete).toHaveBeenCalledWith("/api/attendance/2026-10-19/1");
});
