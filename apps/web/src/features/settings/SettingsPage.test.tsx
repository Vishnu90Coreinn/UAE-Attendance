import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as settingsApi from "../../api/settings";
import type { PayrollSettings } from "../../api/settings";
import { SettingsPage } from "./SettingsPage";

vi.mock("../../api/settings");

const current: PayrollSettings = {
  companyName: "Gulf Glass LLC",
  tagline: "Quality in every pane",
  contactEmail: "hr@gulfglass.example",
  overtimeRatePerHour: 2.22,
  maxBasicHoursPerDay: 8,
  shiftDescription: "06:00 AM - 05:30 PM",
  preparedByLabel: "HR Department",
  approvedByLabel: "General Manager",
};

const companyName = () => screen.getByLabelText("Company name");
const tagline = () => screen.getByLabelText("Tagline");
const email = () => screen.getByLabelText("Contact email");
const overtime = () => screen.getByLabelText("Overtime rate (AED/hr)");
const maxHours = () => screen.getByLabelText("Maximum basic hours per day");
const shift = () => screen.getByLabelText("Shift description");
const preparedBy = () => screen.getByLabelText("Prepared by");
const approvedBy = () => screen.getByLabelText("Approved by");
const save = () => screen.getByRole("button", { name: "Save settings" });

async function renderLoaded(settings: PayrollSettings = current) {
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue(settings);
  const user = userEvent.setup();
  render(<SettingsPage />);
  await screen.findByLabelText("Company name");
  return user;
}

/** Replaces a field's value in one step (typing every character is not what the tests are about). */
function setValue(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SettingsPage - loading", () => {
  it("shows the title, the subtitle and a loading state while the settings load", async () => {
    let resolve!: (value: PayrollSettings) => void;
    vi.mocked(settingsApi.getPayrollSettings).mockReturnValue(
      new Promise<PayrollSettings>((r) => {
        resolve = r;
      }),
    );
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Company details and payroll rates.")).toBeInTheDocument();
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();

    await act(async () => resolve(current));
    expect(await screen.findByLabelText("Company name")).toBeInTheDocument();
    expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
  });

  it("fills every labelled field with the current values", async () => {
    await renderLoaded();

    expect(companyName()).toHaveValue("Gulf Glass LLC");
    expect(tagline()).toHaveValue("Quality in every pane");
    expect(email()).toHaveValue("hr@gulfglass.example");
    expect(overtime()).toHaveValue("2.22");
    expect(maxHours()).toHaveValue("8");
    expect(shift()).toHaveValue("06:00 AM - 05:30 PM");
    expect(preparedBy()).toHaveValue("HR Department");
    expect(approvedBy()).toHaveValue("General Manager");
    expect(settingsApi.getPayrollSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the overtime rate with two decimals", async () => {
    await renderLoaded({ ...current, overtimeRatePerHour: 3 });

    expect(overtime()).toHaveValue("3.00");
  });

  it("uses decimal keyboards for the two numeric fields", async () => {
    await renderLoaded();

    expect(overtime()).toHaveAttribute("inputmode", "decimal");
    expect(maxHours()).toHaveAttribute("inputmode", "decimal");
  });

  it("explains in visible text that a changed overtime rate recalculates open months", async () => {
    await renderLoaded();

    expect(
      screen.getByText("Changing the overtime rate recalculates every month that is not finalised."),
    ).toBeVisible();
  });

  it("shows an error with a Retry button when loading fails, and recovers on retry", async () => {
    vi.mocked(settingsApi.getPayrollSettings)
      .mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."))
      .mockResolvedValueOnce(current);
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Company name")).toHaveValue("Gulf Glass LLC");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(settingsApi.getPayrollSettings).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsPage - change detection", () => {
  it("disables Save while nothing has changed", async () => {
    await renderLoaded();

    expect(save()).toBeDisabled();
  });

  it("enables Save after an edit and disables it again when the edit is undone", async () => {
    await renderLoaded();

    setValue(companyName(), "Gulf Glass Trading LLC");
    expect(save()).toBeEnabled();

    setValue(companyName(), "Gulf Glass LLC");
    expect(save()).toBeDisabled();
  });

  it("does not count spaces around a value as a change", async () => {
    await renderLoaded();

    setValue(companyName(), "  Gulf Glass LLC  ");

    expect(save()).toBeDisabled();
  });

  it("does not count 2.220 versus 2.22 as a change", async () => {
    await renderLoaded();

    setValue(overtime(), "2.220");

    expect(save()).toBeDisabled();
  });
});

describe("SettingsPage - validation", () => {
  it("shows a field's error as soon as the user leaves that field", async () => {
    const user = await renderLoaded();

    await user.clear(companyName());
    await user.tab();

    expect(companyName()).toHaveAccessibleDescription("Enter the company name.");
    expect(companyName()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the company name.");
  });

  it("does not show an error before the user has left the field", async () => {
    const user = await renderLoaded();

    await user.clear(companyName());

    expect(companyName()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists every problem on submit, focuses the first invalid field and does not call the API", async () => {
    const user = await renderLoaded();
    setValue(companyName(), "   ");
    setValue(email(), "");
    setValue(overtime(), "");
    setValue(maxHours(), "");
    setValue(shift(), "");
    setValue(preparedBy(), "");
    setValue(approvedBy(), "");

    await user.click(save());

    expect(companyName()).toHaveAccessibleDescription("Enter the company name.");
    expect(email()).toHaveAccessibleDescription("Enter the contact email.");
    expect(overtime()).toHaveAccessibleDescription("Enter the overtime rate.");
    expect(maxHours()).toHaveAccessibleDescription("Enter the maximum basic hours per day.");
    expect(shift()).toHaveAccessibleDescription("Enter the shift description.");
    expect(preparedBy()).toHaveAccessibleDescription(expect.stringContaining("Enter the Prepared by label."));
    expect(approvedBy()).toHaveAccessibleDescription(expect.stringContaining("Enter the Approved by label."));
    [companyName(), email(), overtime(), maxHours(), shift(), preparedBy(), approvedBy()].forEach((field) =>
      expect(field).toHaveAttribute("aria-invalid", "true"),
    );
    expect(tagline()).not.toHaveAttribute("aria-invalid");
    expect(companyName()).toHaveFocus();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter the company name.");
    expect(alert).toHaveTextContent("Enter the overtime rate.");
    expect(settingsApi.updatePayrollSettings).not.toHaveBeenCalled();
  });

  it("allows an empty tagline", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue({ ...current, tagline: "" });
    const user = await renderLoaded();

    setValue(tagline(), "");
    await user.click(save());

    await waitFor(() => expect(settingsApi.updatePayrollSettings).toHaveBeenCalledTimes(1));
    expect(settingsApi.updatePayrollSettings).toHaveBeenCalledWith({ ...current, tagline: "" });
  });

  it.each([
    ["Company name", companyName, "N".repeat(121), "Company name must be at most 120 characters."],
    ["Tagline", tagline, "T".repeat(201), "Tagline must be at most 200 characters."],
    ["Contact email", email, "e".repeat(110) + "@example.com", "Contact email must be at most 120 characters."],
    ["Contact email", email, "not-an-email", "Enter a valid email address, for example hr@example.com."],
    ["Contact email", email, "two words@example.com", "Enter a valid email address, for example hr@example.com."],
    ["Shift description", shift, "S".repeat(61), "Shift description must be at most 60 characters."],
    ["Prepared by", preparedBy, "P".repeat(61), "Prepared by must be at most 60 characters."],
    ["Approved by", approvedBy, "A".repeat(61), "Approved by must be at most 60 characters."],
  ])("rejects a too long or malformed %s", async (_name, field, value, message) => {
    const user = await renderLoaded();
    setValue(field(), value);

    await user.click(save());

    expect(field()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(settingsApi.updatePayrollSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["abc", "Enter the overtime rate as a number, for example 2.50."],
    ["-1", "Overtime rate cannot be negative."],
    ["1000", "Overtime rate must be at most 999.99."],
    ["2.505", "Overtime rate can have at most 2 decimal places."],
  ])("rejects the overtime rate %s", async (value, message) => {
    const user = await renderLoaded();
    setValue(overtime(), value);

    await user.click(save());

    expect(overtime()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(overtime()).toHaveFocus();
    expect(settingsApi.updatePayrollSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["abc", "Enter the maximum basic hours as a number, for example 8."],
    ["0", "Maximum basic hours must be greater than 0."],
    ["-8", "Maximum basic hours must be greater than 0."],
    ["24.5", "Maximum basic hours must be at most 24."],
    ["8.123", "Maximum basic hours can have at most 2 decimal places."],
  ])("rejects the maximum basic hours %s", async (value, message) => {
    const user = await renderLoaded();
    setValue(maxHours(), value);

    await user.click(save());

    expect(maxHours()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(settingsApi.updatePayrollSettings).not.toHaveBeenCalled();
  });

  it.each(["0", "999.99", ".5", "2.5"])("accepts the overtime rate %s", async (value) => {
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue(current);
    const user = await renderLoaded();
    setValue(overtime(), value);

    await user.click(save());

    await waitFor(() => expect(settingsApi.updatePayrollSettings).toHaveBeenCalledTimes(1));
    expect(settingsApi.updatePayrollSettings).toHaveBeenCalledWith(
      expect.objectContaining({ overtimeRatePerHour: Number(value) }),
    );
  });

  it.each(["0.5", "24", "8.25"])("accepts the maximum basic hours %s", async (value) => {
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue(current);
    const user = await renderLoaded();
    setValue(maxHours(), value);

    await user.click(save());

    await waitFor(() => expect(settingsApi.updatePayrollSettings).toHaveBeenCalledTimes(1));
    expect(settingsApi.updatePayrollSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxBasicHoursPerDay: Number(value) }),
    );
  });
});

describe("SettingsPage - saving", () => {
  it("sends every setting with numbers and trimmed text, then announces success and shows the stored values", async () => {
    const stored = { ...current, companyName: "Gulf Glass Trading LLC", overtimeRatePerHour: 2.5 };
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue(stored);
    const user = await renderLoaded();

    setValue(companyName(), "  Gulf Glass Trading LLC ");
    setValue(overtime(), "2.5");
    await user.click(save());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Settings saved."));
    expect(settingsApi.updatePayrollSettings).toHaveBeenCalledTimes(1);
    expect(settingsApi.updatePayrollSettings).toHaveBeenCalledWith(stored);
    expect(companyName()).toHaveValue("Gulf Glass Trading LLC");
    expect(overtime()).toHaveValue("2.50");
    expect(save()).toBeDisabled();
  });

  it("shows a disabled Saving... button with a busy state while the request is pending", async () => {
    let resolve!: (value: PayrollSettings) => void;
    vi.mocked(settingsApi.updatePayrollSettings).mockReturnValue(
      new Promise<PayrollSettings>((r) => {
        resolve = r;
      }),
    );
    const user = await renderLoaded();
    setValue(overtime(), "2.5");

    await user.click(save());

    const pending = screen.getByRole("button", { name: "Saving..." });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    await act(async () => resolve({ ...current, overtimeRatePerHour: 2.5 }));
    expect(await screen.findByRole("button", { name: "Save settings" })).toBeDisabled();
  });

  it("clears the success message as soon as the user edits again", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue({ ...current, overtimeRatePerHour: 2.5 });
    const user = await renderLoaded();
    setValue(overtime(), "2.5");
    await user.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Settings saved."));

    setValue(tagline(), "A new tagline");

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(save()).toBeEnabled();
  });

  it("keeps a live status region mounted before anything is saved", async () => {
    await renderLoaded();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("SettingsPage - failed saves", () => {
  it("maps server field errors to their fields, keeps every typed value and leaves Save available", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockRejectedValue(
      new ApiError(400, "Overtime rate is too high.", undefined, undefined, {
        overtimeRatePerHour: ["Overtime rate is too high."],
        contactEmail: ["Email domain is not allowed."],
      }),
    );
    const user = await renderLoaded();
    setValue(companyName(), "Edited Name");
    setValue(overtime(), "5");

    await user.click(save());

    await screen.findByText("Overtime rate is too high.", { selector: "p[id]" });
    expect(overtime()).toHaveAccessibleDescription(expect.stringContaining("Overtime rate is too high."));
    expect(overtime()).toHaveAttribute("aria-invalid", "true");
    expect(email()).toHaveAccessibleDescription(expect.stringContaining("Email domain is not allowed."));
    expect(screen.getByRole("alert")).toHaveTextContent("Overtime rate is too high.");
    expect(screen.getByRole("alert")).toHaveTextContent("Email domain is not allowed.");
    expect(email()).toHaveFocus();
    expect(companyName()).toHaveValue("Edited Name");
    expect(overtime()).toHaveValue("5");
    expect(save()).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("maps the remaining server keys (maxBasicHoursPerDay, shiftDescription, labels) to their fields", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockRejectedValue(
      new ApiError(400, "Invalid.", undefined, undefined, {
        companyName: ["Company name is taken."],
        tagline: ["Tagline is not allowed."],
        maxBasicHoursPerDay: ["Hours are too high."],
        shiftDescription: ["Shift is invalid."],
        preparedByLabel: ["Prepared by is invalid."],
        approvedByLabel: ["Approved by is invalid."],
      }),
    );
    const user = await renderLoaded();
    setValue(tagline(), "x");

    await user.click(save());

    await screen.findByText("Hours are too high.", { selector: "p[id]" });
    expect(companyName()).toHaveAccessibleDescription(expect.stringContaining("Company name is taken."));
    expect(tagline()).toHaveAccessibleDescription(expect.stringContaining("Tagline is not allowed."));
    expect(maxHours()).toHaveAccessibleDescription(expect.stringContaining("Hours are too high."));
    expect(shift()).toHaveAccessibleDescription(expect.stringContaining("Shift is invalid."));
    expect(preparedBy()).toHaveAccessibleDescription(expect.stringContaining("Prepared by is invalid."));
    expect(approvedBy()).toHaveAccessibleDescription(expect.stringContaining("Approved by is invalid."));
  });

  it("clears a server error once the user edits that field", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockRejectedValue(
      new ApiError(400, "Overtime rate is too high.", undefined, undefined, {
        overtimeRatePerHour: ["Overtime rate is too high."],
      }),
    );
    const user = await renderLoaded();
    setValue(overtime(), "5");
    await user.click(save());
    await screen.findByText("Overtime rate is too high.", { selector: "p[id]" });

    setValue(overtime(), "4");

    expect(overtime()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a refusal such as 403 in the alert and keeps the typed values", async () => {
    vi.mocked(settingsApi.updatePayrollSettings).mockRejectedValue(
      new ApiError(403, "You do not have permission to change settings."),
    );
    const user = await renderLoaded();
    setValue(overtime(), "2.5");

    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to change settings.");
    expect(overtime()).toHaveValue("2.5");
    expect(save()).toBeEnabled();
  });

  it("shows an unreachable server in the alert and lets the user save again", async () => {
    vi.mocked(settingsApi.updatePayrollSettings)
      .mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."))
      .mockResolvedValueOnce({ ...current, overtimeRatePerHour: 2.5 });
    const user = await renderLoaded();
    setValue(overtime(), "2.5");

    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
    expect(overtime()).toHaveValue("2.5");

    await user.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Settings saved."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
