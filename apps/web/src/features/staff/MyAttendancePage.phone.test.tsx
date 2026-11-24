import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as staffApi from "../../api/staff";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { MyAttendancePage } from "./MyAttendancePage";

vi.mock("../../api/staff");
vi.mock("./SelfieDialog", () => ({ SelfieDialog: () => <div>Selfie camera</div> }));

function me(dayType: string | null, nextKind: "In" | "Out" = "In"): staffApi.StaffMe {
  return {
    workerId: 1, code: "EMP-001", name: "Jesus Salazar", department: "Finance", shiftStart: "09:00", shiftEnd: "17:00", officeCheckOn: false,
    today: { date: "2026-11-22", status: "Not In Yet", hours: 0, lateMinutes: 0, earlyLeaveMinutes: 0, firstIn: "08:55", lastOut: null, isLate: false, isEarlyLeave: false, missingSignOut: false, outsideOffice: false, punchCount: 0, note: null },
    nextKind, punches: [], dayType,
  } as unknown as staffApi.StaffMe;
}

const day = { date: "2026-11-20", status: "Present", hours: 8, lateMinutes: 0, earlyLeaveMinutes: 0, firstIn: "08:55", lastOut: "17:02", isLate: false, isEarlyLeave: false, missingSignOut: false, outsideOffice: false, punchCount: 2, note: null } as unknown as staffApi.StaffDay;

function renderPage() {
  render(
    <MemoryRouter>
      <MyAttendancePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  vi.mocked(staffApi.getMyDays).mockResolvedValue([day]);
});
afterEach(restoreViewport);

describe("My Attendance on a phone", () => {
  it("offers one big Sign in action and lists the days as rows, not a table", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me(null));
    renderPage();

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Not signed in yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows Sign out once signed in", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me(null, "Out"));
    renderPage();

    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByText(/In since 08:55/)).toBeInTheDocument();
  });

  it("asks on a day off in a sheet with a full Sign in anyway button", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me("Weekly off"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(screen.getByText(/Today is your weekly off/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in anyway" }));
    expect(await screen.findByText("Selfie camera")).toBeInTheDocument();
  });

  it("says there is no connection and holds the button instead of failing after the photo", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me(null));
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderPage();

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("No connection");
    online.mockRestore();
  });
});
