import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as authApi from "./api/auth";
import * as settingsApi from "./api/settings";
import * as workersApi from "./api/workers";
import * as attendanceApi from "./api/attendance";
import * as payrollApi from "./api/payroll";
import * as leaveApi from "./api/leave";
import { setAuthToken } from "./api/client";
import { AuthProvider, TOKEN_STORAGE_KEY } from "./contexts/AuthContext";

vi.mock("./components/HealthChip", () => ({
  HealthChip: () => <div>health chip</div>,
}));
vi.mock("./api/auth");
vi.mock("./api/workers");
vi.mock("./api/settings");
vi.mock("./api/attendance");
vi.mock("./api/payroll");
vi.mock("./api/leave");

const admin = { id: 1, username: "admin", role: "Administrator" as const };

const payrollSettings: settingsApi.PayrollSettings = {
  companyName: "Gulf Glass LLC",
  tagline: "",
  contactEmail: "hr@gulfglass.example",
  overtimeRatePerHour: 2.22,
  maxBasicHoursPerDay: 8,
  shiftDescription: "06:00 AM - 05:30 PM",
  preparedByLabel: "HR Department",
  approvedByLabel: "General Manager",
};

function renderAt(path: string) {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          {
            path: "*",
            element: (
              <AuthProvider>
                <App />
              </AuthProvider>
            ),
          },
        ],
        { initialEntries: [path] },
      )}
    />,
  );
}

function signInWithStoredToken(
  role: "Administrator" | "HR Staff" | "Viewer" = "Administrator",
) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
  vi.mocked(authApi.getMe).mockResolvedValue({ ...admin, role });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(workersApi.listWorkers).mockResolvedValue([]);
  vi.mocked(leaveApi.listLeave).mockResolvedValue([]);
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue(payrollSettings);
  vi.mocked(attendanceApi.getAttendance).mockResolvedValue({
    date: "2026-10-19",
    isFinalised: false,
    rows: [],
  });
  vi.mocked(payrollApi.getPayroll).mockResolvedValue({
    period: "2026-10",
    status: "Draft",
    revision: "rev",
    company: {
      companyName: "Gulf Glass LLC",
      tagline: "",
      contactEmail: "hr@gulfglass.example",
      preparedByLabel: "HR",
      approvedByLabel: "GM",
    },
    lines: [],
    totals: {
      daysWorked: 0,
      basicHours: 0,
      overtimeHours: 0,
      basicPay: 0,
      overtimePay: 0,
      totalPay: 0,
    },
  });
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("App", () => {
  it.each(["Administrator", "HR Staff", "Viewer"] as const)(
    "opens leave management for %s with appropriate actions",
    async (role) => {
      signInWithStoredToken(role);
      renderAt("/leave");
      expect(
        await screen.findByText("No leave requests match these filters."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "New Leave Request" }) !== null,
      ).toBe(role !== "Viewer");
      expect(
        screen.getByRole("link", { name: "Leave Management" }),
      ).toHaveAttribute("aria-current", "page");
    },
  );
  it("requires sign-in for leave management", async () => {
    renderAt("/leave");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(leaveApi.listLeave).not.toHaveBeenCalled();
  });
  it.each(["Administrator", "HR Staff", "Viewer"] as const)(
    "allows %s to print/export payroll",
    async (role) => {
      signInWithStoredToken(role);
      renderAt("/payroll");
      expect(await screen.findByRole("table")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Export PDF" })).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "Finalise month" }) !== null,
      ).toBe(role === "Administrator");
      expect(
        screen.getByRole("link", { name: "Payroll Summary" }),
      ).toHaveAttribute("aria-current", "page");
    },
  );
  it("requires sign-in for payroll", async () => {
    renderAt("/payroll");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(payrollApi.getPayroll).not.toHaveBeenCalled();
  });
  it("updates the signed-in header immediately after saving company settings", async () => {
    signInWithStoredToken("Administrator");
    vi.mocked(settingsApi.updatePayrollSettings).mockResolvedValue({
      ...payrollSettings,
      companyName: "New Company LLC",
    });
    renderAt("/settings");
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText("Company name"));
    await user.type(screen.getByLabelText("Company name"), "New Company LLC");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      await screen.findByRole("heading", { name: "New Company LLC" }),
    ).toBeInTheDocument();
  });
  it.each(["Administrator", "HR Staff", "Viewer"] as const)(
    "serves attendance to %s",
    async (role) => {
      signInWithStoredToken(role);
      renderAt("/attendance");
      expect(
        await screen.findByRole("heading", { name: "Daily Attendance" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("No workers for this date."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Daily Attendance" }),
      ).toHaveAttribute("aria-current", "page");
    },
  );
  it("requires sign-in for attendance", async () => {
    renderAt("/attendance");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(attendanceApi.getAttendance).not.toHaveBeenCalled();
  });
  it("protects attendance edits when navigating to another tab", async () => {
    signInWithStoredToken("HR Staff");
    vi.mocked(attendanceApi.getAttendance).mockResolvedValue({
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
    });
    renderAt("/attendance");
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("Status for Ahmed Khan"), {
      target: { value: "Absent" },
    });
    await user.click(screen.getByRole("link", { name: "Worker Directory" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Discard unsaved changes?",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Worker Directory" }));
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Worker Directory" }),
    ).toBeInTheDocument();
  });
  it("sends a signed-out visit to the root to the login page", async () => {
    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Worker Directory" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("health chip")).not.toBeInTheDocument();
  });

  it("opens the Worker Directory at the root when signed in", async () => {
    signInWithStoredToken();
    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: "Worker Directory" }),
    ).toBeInTheDocument();
    expect(workersApi.listWorkers).toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("link", { name: "Worker Directory" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("serves the Worker Directory at /workers inside the layout", async () => {
    signInWithStoredToken();
    renderAt("/workers");

    expect(
      await screen.findByRole("heading", { name: "Worker Directory" }),
    ).toBeInTheDocument();
    expect(screen.getByText("health chip")).toBeInTheDocument();
  });

  it("sends a signed-out visit to /workers to the login page", async () => {
    renderAt("/workers");

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(workersApi.listWorkers).not.toHaveBeenCalled();
  });

  it("serves Settings at /settings to an Administrator, inside the layout, with its tab current", async () => {
    signInWithStoredToken("Administrator");
    renderAt("/settings");

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Company name")).toHaveValue(
      "Gulf Glass LLC",
    );
    expect(screen.getByText("health chip")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each(["HR Staff", "Viewer"] as const)(
    "tells %s who types /settings that they have no access, without loading or showing the form",
    async (role) => {
      signInWithStoredToken(role);
      renderAt("/settings");

      expect(
        await screen.findByText("You do not have access to this page"),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Settings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Settings" }),
      ).not.toBeInTheDocument();
      // Any user may load shell branding; the restricted settings form never loads.
      expect(settingsApi.getPayrollSettings).toHaveBeenCalledTimes(1);
      expect(screen.getByText("health chip")).toBeInTheDocument();
    },
  );

  it("sends a signed-out visit to /settings to the login page", async () => {
    renderAt("/settings");

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(settingsApi.getPayrollSettings).not.toHaveBeenCalled();
  });

  it("shows a not-found page for unknown routes when signed in", async () => {
    signInWithStoredToken();
    renderAt("/nope");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });

  it("redirects a signed-in visit to /login to the Worker Directory", async () => {
    signInWithStoredToken();
    renderAt("/login");

    expect(
      await screen.findByRole("heading", { name: "Worker Directory" }),
    ).toBeInTheDocument();
  });

  it("returns to the originally requested page after signing in", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: "tok-1",
      expiresUtc: "2026-10-20T20:00:00Z",
      user: admin,
    });
    renderAt("/nope");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
