import { beforeEach, expect, it, vi } from "vitest";
import { apiGet, apiGetBlob } from "./client";
import { getPayroll, getPayrollPdf } from "./payroll";
vi.mock("./client", () => ({ apiGet: vi.fn(), apiGetBlob: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("loads payroll for a month", async () => {
  await getPayroll("2026-10");
  expect(apiGet).toHaveBeenCalledWith("/api/payroll?month=2026-10");
});
it("requests a PDF matching the displayed revision", async () => {
  await getPayrollPdf("2026-10", "ab-cd");
  expect(apiGetBlob).toHaveBeenCalledWith(
    "/api/payroll/pdf?month=2026-10&revision=ab-cd",
  );
});
