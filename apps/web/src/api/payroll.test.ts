import { beforeEach, expect, it, vi } from "vitest";
import { apiDeleteJson, apiGet, apiGetBlob, apiPost } from "./client";
import {
  finalisePayroll,
  getPayroll,
  getPayrollPdf,
  reopenPayroll,
} from "./payroll";
vi.mock("./client", () => ({
  apiGet: vi.fn(),
  apiGetBlob: vi.fn(),
  apiPost: vi.fn(),
  apiDeleteJson: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it("loads payroll for a month", async () => {
  await getPayroll("2026-10");
  expect(apiGet).toHaveBeenCalledWith("/api/payroll?month=2026-10");
});
it("finalises the displayed report revision", async () => {
  await finalisePayroll("2026-10", "revision-1");
  expect(apiPost).toHaveBeenCalledWith("/api/payroll/2026-10/finalise", {
    revision: "revision-1",
  });
});
it("reopens payroll with the supplied reason", async () => {
  await reopenPayroll("2026-10", "Correct attendance");
  expect(apiDeleteJson).toHaveBeenCalledWith("/api/payroll/2026-10/finalise", {
    reason: "Correct attendance",
  });
});
it("requests a PDF matching the displayed revision", async () => {
  await getPayrollPdf("2026-10", "ab-cd");
  expect(apiGetBlob).toHaveBeenCalledWith(
    "/api/payroll/pdf?month=2026-10&revision=ab-cd",
  );
});
