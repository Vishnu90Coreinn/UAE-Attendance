import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import { getPayrollSettings, updatePayrollSettings, type PayrollSettings } from "./settings";

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

  it("saves the payroll settings with PUT and returns what the server stored", async () => {
    const saved = { ...settings, overtimeRatePerHour: 2.5 };
    vi.mocked(client.apiPut).mockResolvedValue(saved);

    await expect(updatePayrollSettings(saved)).resolves.toEqual(saved);

    expect(client.apiPut).toHaveBeenCalledWith("/api/settings/payroll", saved);
  });
});
