import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import { getPayrollSettings, type PayrollSettings } from "./settings";

vi.mock("./client");

const settings: PayrollSettings = {
  companyName: "Company",
  tagline: "Tagline",
  contactEmail: "hr@example.com",
  overtimeRatePerHour: 2.22,
  maxBasicHoursPerDay: 8,
  shiftDescription: "06:00 AM - 05:30 PM",
  preparedByLabel: "HR Department",
  approvedByLabel: "General Manager",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("settings api", () => {
  it("reads the payroll settings", async () => {
    vi.mocked(client.apiGet).mockResolvedValue(settings);

    await expect(getPayrollSettings()).resolves.toEqual(settings);

    expect(client.apiGet).toHaveBeenCalledWith("/api/settings/payroll");
  });
});
