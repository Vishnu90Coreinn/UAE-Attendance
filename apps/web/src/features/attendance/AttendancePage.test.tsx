import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/attendance";
import type { AttendanceDay } from "../../api/attendance";
import { ApiError } from "../../api/client";
import { getPayrollSettings } from "../../api/settings";
import { useAuth } from "../../contexts/AuthContext";
import { AttendancePage } from "./AttendancePage";

vi.mock("../../api/attendance");
vi.mock("../../api/settings");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
const day: AttendanceDay = {
  date: "2026-10-19",
  isFinalised: false,
  rows: [
    {
      worker: {
        id: 1,
        workerCode: "EMP-001",
        fullName: "Ahmed Khan",
        designation: "Installer",
        hourlyRate: 12.5,
        overtimeRate: null,
        effectiveOvertimeRate: 2.22,
        isActive: true,
      },
      record: null,
      dailyPay: { basicPay: 0, overtimePay: 0, totalPay: 0, daysWorked: 0 },
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "mgr", role: "Manager" },
    token: "t",
    login: vi.fn(),
    logout: vi.fn(),
  });
  vi.mocked(api.getAttendance).mockResolvedValue(day);
  vi.mocked(getPayrollSettings).mockResolvedValue({
    companyName: "Company",
    tagline: "",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 8,
    shiftDescription: "06:00 AM - 05:30 PM",
    preparedByLabel: "HR Department",
    approvedByLabel: "General Manager",
  });
  vi.mocked(api.saveAttendance).mockResolvedValue(day);
});
async function loaded() {
  const user = userEvent.setup();
  render(<AttendancePage />);
  await screen.findByRole("table");
  return user;
}
it("shows a loading state", () => {
  vi.mocked(api.getAttendance).mockReturnValue(new Promise(() => {}));
  render(<AttendancePage />);
  expect(screen.getByText("Loading attendance...")).toBeInTheDocument();
});
it("starts unrecorded with zero pay and disabled hours; settings supply the shift note", async () => {
  await loaded();
  expect(screen.getByLabelText("Status for Ahmed Khan")).toHaveValue("");
  expect(screen.getByLabelText("Basic hours for Ahmed Khan")).toBeDisabled();
  expect(screen.getByLabelText("Overtime hours for Ahmed Khan")).toBeDisabled();
  expect(screen.getByText(/Standard Shift: 06:00 AM/)).toHaveTextContent(
    "Overtime Rate: 2.22 AED/hr",
  );
  expect(screen.getByRole("button", { name: "Save day" })).toBeDisabled();
});
it("previews pay and saves only after Save day, then uses server values", async () => {
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Present",
  );
  await user.clear(screen.getByLabelText("Basic hours for Ahmed Khan"));
  await user.type(screen.getByLabelText("Basic hours for Ahmed Khan"), "8");
  await user.clear(screen.getByLabelText("Overtime hours for Ahmed Khan"));
  await user.type(screen.getByLabelText("Overtime hours for Ahmed Khan"), "2");
  expect(screen.getByText("104.44")).toBeInTheDocument();
  expect(api.saveAttendance).not.toHaveBeenCalled();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  vi.mocked(api.saveAttendance).mockResolvedValue({
    ...day,
    rows: [
      {
        ...day.rows[0],
        record: { status: "Present", basicHours: 8, overtimeHours: 2 },
        dailyPay: {
          basicPay: 100,
          overtimePay: 4.44,
          totalPay: 104.44,
          daysWorked: 1,
        },
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
    { workerId: 1, status: "Present", basicHours: 8, overtimeHours: 2 },
  ]);
  expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
});
it("refuses excessive or blank present hours before sending", async () => {
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Present",
  );
  fireEvent.change(screen.getByLabelText("Basic hours for Ahmed Khan"), {
    target: { value: "9" },
  });
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Basic hours must be greater than 0 and at most 8",
  );
  expect(api.saveAttendance).not.toHaveBeenCalled();
});
it("switching to absent clears both hours", async () => {
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Absent",
  );
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
    { workerId: 1, status: "Absent", basicHours: 0, overtimeHours: 0 },
  ]);
});
it("clears recorded attendance in the same batch", async () => {
  vi.mocked(api.getAttendance).mockResolvedValue({
    ...day,
    rows: [
      {
        ...day.rows[0],
        record: { status: "Present", basicHours: 8, overtimeHours: 2 },
      },
    ],
  });
  const user = await loaded();
  await user.selectOptions(screen.getByLabelText("Status for Ahmed Khan"), "");
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
    { workerId: 1, status: null, basicHours: 0, overtimeHours: 0 },
  ]);
});
function signInAs(role: "Supervisor" | "Administrator") {
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "sup.omar", role },
    token: "t",
    login: vi.fn(),
    logout: vi.fn(),
  });
}
/** What the API returns to a Supervisor: no wages and no pay. */
const supervisorDay: AttendanceDay = {
  ...day,
  rows: [
    {
      ...day.rows[0],
      worker: {
        ...day.rows[0].worker,
        hourlyRate: null,
        overtimeRate: null,
        effectiveOvertimeRate: null,
      },
      dailyPay: null,
    },
  ],
};
it("a Manager sees the Total Pay column and the overtime rate in the shift note", async () => {
  await loaded();
  expect(
    screen.getByRole("columnheader", { name: "Total Pay (AED)" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Standard Shift/)).toHaveTextContent(
    "Overtime Rate: 2.22 AED/hr",
  );
});
it("a Supervisor records attendance without any pay column, overtime rate or live pay preview", async () => {
  signInAs("Supervisor");
  vi.mocked(api.getAttendance).mockResolvedValue(supervisorDay);
  vi.mocked(getPayrollSettings).mockResolvedValue({
    companyName: "Company",
    tagline: "",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: null,
    maxBasicHoursPerDay: 8,
    shiftDescription: "06:00 AM - 05:30 PM",
    preparedByLabel: "HR Department",
    approvedByLabel: "General Manager",
  });
  const user = await loaded();
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Worker",
    "Status",
    "Basic Hours",
    "Overtime Hours",
  ]);
  expect(screen.getByText(/Standard Shift: 06:00 AM/)).not.toHaveTextContent(
    /Overtime Rate|AED/,
  );
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Present",
  );
  fireEvent.change(screen.getByLabelText("Basic hours for Ahmed Khan"), {
    target: { value: "8" },
  });
  fireEvent.change(screen.getByLabelText("Overtime hours for Ahmed Khan"), {
    target: { value: "2" },
  });
  expect(document.body).not.toHaveTextContent(/null|NaN|undefined|AED/);
  vi.mocked(api.saveAttendance).mockResolvedValue({
    ...supervisorDay,
    rows: [
      {
        ...supervisorDay.rows[0],
        record: { status: "Present", basicHours: 8, overtimeHours: 2 },
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
    { workerId: 1, status: "Present", basicHours: 8, overtimeHours: 2 },
  ]);
  expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/null|NaN|undefined/);
});
it("gives Supervisor inputs a thumb-sized touch target", async () => {
  signInAs("Supervisor");
  vi.mocked(api.getAttendance).mockResolvedValue(supervisorDay);
  await loaded();
  for (const label of [
    "Status for Ahmed Khan",
    "Basic hours for Ahmed Khan",
    "Overtime hours for Ahmed Khan",
    "Work date",
  ]) {
    expect(screen.getByLabelText(label).className).toContain("min-h-11");
  }
});
it("an Administrator can also record attendance", async () => {
  signInAs("Administrator");
  await loaded();
  expect(screen.getByLabelText("Status for Ahmed Khan")).toBeEnabled();
});
it("locked days disable editing", async () => {
  vi.mocked(api.getAttendance).mockResolvedValue({ ...day, isFinalised: true });
  await loaded();
  expect(screen.getByText(/This month is finalised/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("preserves unsaved input after a server validation failure", async () => {
  vi.mocked(api.saveAttendance).mockRejectedValue(
    new ApiError(400, "Hours rejected", undefined, undefined, {
      "rows[0].basicHours": ["Maximum basic hours changed. Reload the day."],
    }),
  );
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Absent",
  );
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Maximum basic hours changed. Reload the day.",
  );
  expect(screen.getByLabelText("Status for Ahmed Khan")).toHaveValue("Absent");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});
it("load failures have retry and empty days have an explanation", async () => {
  vi.mocked(api.getAttendance).mockRejectedValueOnce(
    new ApiError(0, "Unable to reach the server."),
  );
  const user = userEvent.setup();
  render(<AttendancePage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach the server.",
  );
  vi.mocked(api.getAttendance).mockResolvedValue({ ...day, rows: [] });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("No workers for this date."),
  ).toBeInTheDocument();
});
it("requires confirmation before a date change discards edits", async () => {
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Absent",
  );
  const previousCalls = vi.mocked(api.getAttendance).mock.calls.length;
  fireEvent.change(screen.getByLabelText("Work date"), {
    target: { value: "2026-10-18" },
  });
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "Discard unsaved changes?",
  );
  expect(api.getAttendance).toHaveBeenCalledTimes(previousCalls);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Work date"), {
    target: { value: "2026-10-18" },
  });
  await user.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() =>
    expect(api.getAttendance).toHaveBeenLastCalledWith("2026-10-18"),
  );
});
it.each([
  ["8", "17", "must not exceed 24"],
  ["7.751", "0", "at most 2 decimal places"],
  ["8", "-1", "0 or greater"],
  ["", "0", "greater than 0"],
])("rejects basic %s and overtime %s", async (basic, overtime, message) => {
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Present",
  );
  fireEvent.change(screen.getByLabelText("Basic hours for Ahmed Khan"), {
    target: { value: basic },
  });
  fireEvent.change(screen.getByLabelText("Overtime hours for Ahmed Khan"), {
    target: { value: overtime },
  });
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(api.saveAttendance).not.toHaveBeenCalled();
});
it("disables date, status and save while a batch is pending", async () => {
  let resolve!: (value: AttendanceDay) => void;
  vi.mocked(api.saveAttendance).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Absent",
  );
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  expect(screen.getByLabelText("Work date")).toBeDisabled();
  expect(screen.getByLabelText("Status for Ahmed Khan")).toBeDisabled();
  await act(async () => resolve(day));
});
it("uses the UAE business date before UTC midnight", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T20:30:00Z"));
  try {
    render(<AttendancePage />);
    expect(screen.getByLabelText("Work date")).toHaveValue("2026-10-20");
    expect(api.getAttendance).toHaveBeenCalledWith("2026-10-20");
    await act(async () => {});
  } finally {
    vi.useRealTimers();
  }
});
it("rejects a future date without changing the displayed day", async () => {
  await loaded();
  fireEvent.change(screen.getByLabelText("Work date"), {
    target: { value: "9999-12-31" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Future dates are not allowed.",
  );
  expect(api.getAttendance).toHaveBeenCalledTimes(1);
});
it("validates changed rows only when settings have changed since an older record", async () => {
  vi.mocked(getPayrollSettings).mockResolvedValue({
    companyName: "Company",
    tagline: "",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 7,
    shiftDescription: "Shift",
    preparedByLabel: "HR",
    approvedByLabel: "GM",
  });
  vi.mocked(api.getAttendance).mockResolvedValue({
    ...day,
    rows: [
      day.rows[0],
      {
        ...day.rows[0],
        worker: {
          ...day.rows[0].worker,
          id: 2,
          fullName: "Sara Ali",
          workerCode: "EMP-002",
        },
        record: { status: "Present", basicHours: 8, overtimeHours: 0 },
      },
    ],
  });
  const user = await loaded();
  await user.selectOptions(
    screen.getByLabelText("Status for Ahmed Khan"),
    "Absent",
  );
  await user.click(screen.getByRole("button", { name: "Save day" }));
  expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
    { workerId: 1, status: "Absent", basicHours: 0, overtimeHours: 0 },
  ]);
});
