import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as staffApi from "../../api/staff";
import { MyAttendancePage } from "./MyAttendancePage";

vi.mock("../../api/staff");
vi.mock("./SelfieDialog", () => ({ SelfieDialog: () => <div>Selfie camera</div> }));

function me(dayType: string | null, punches: staffApi.Punch[] = []): staffApi.StaffMe {
  return {
    workerId: 1, code: "EMP-001", name: "Jesus Salazar", department: "Finance", shiftStart: "09:00", shiftEnd: "17:00", officeCheckOn: false,
    today: { date: "2026-11-22", status: "NotIn", hours: 0, lateMinutes: 0, earlyLeaveMinutes: 0, firstIn: null, lastOut: null, isLate: false, isEarlyLeave: false, missingSignOut: false, outsideOffice: false, punchCount: punches.length, note: null },
    nextKind: "In", punches, dayType,
  } as unknown as staffApi.StaffMe;
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyAttendancePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(staffApi.getMyDays).mockResolvedValue([]);
});

describe("MyAttendancePage sign-in on a day off", () => {
  it("warns on a weekly off and carries on only when the employee chooses to", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me("Weekly off"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Sign in/ }));

    expect(screen.getByText(/Today is your weekly off/)).toBeInTheDocument();
    expect(screen.queryByText("Selfie camera")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign in anyway" }));
    expect(await screen.findByText("Selfie camera")).toBeInTheDocument();
  });

  it("names the public holiday, and Cancel goes back without opening the camera", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me("National Day"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Sign in/ }));

    expect(screen.getByText(/public holiday: National Day/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Selfie camera")).not.toBeInTheDocument();
  });

  it("opens the camera straight away on a working day", async () => {
    vi.mocked(staffApi.getMyStaff).mockResolvedValue(me(null));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Sign in/ }));
    expect(await screen.findByText("Selfie camera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in anyway" })).not.toBeInTheDocument();
  });
});
