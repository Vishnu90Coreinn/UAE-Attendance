import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as attendanceApi from "../api/attendance";
import * as authApi from "../api/auth";
import { setAuthToken } from "../api/client";
import * as settingsApi from "../api/settings";
import { COMPANY_NAME } from "../branding";
import { AuthProvider, TOKEN_STORAGE_KEY } from "../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../test-viewport";
import { Layout } from "./Layout";

vi.mock("../api/auth");
vi.mock("../api/settings");
vi.mock("../api/attendance");

type TestRole = authApi.CurrentUser["role"];

/** Renders the Layout as it appears on a phone, under the real AuthProvider with a restored session. */
async function renderPhone(role: TestRole = "Manager", username = "mgr.sam", initialPath = "/workers") {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
  vi.mocked(authApi.getMe).mockResolvedValue({ id: 1, username, role });
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<Layout />}>
            <Route path="workers" element={<p>workers content</p>} />
            <Route path="deductions" element={<p>deductions content</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("navigation", { name: "Main" });
}

beforeEach(() => {
  sessionStorage.clear();
  mockViewport("phone");
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({
    companyName: "Gulf Glass LLC",
    tagline: "Tagline",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 8,
    shiftDescription: "Shift",
    preparedByLabel: "HR",
    approvedByLabel: "GM",
  });
  vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue({
    submittedTotal: 0,
    submitted: [],
    rejectedTotal: 0,
    rejected: [],
  });
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
  restoreViewport();
});

describe("Layout on a phone", () => {
  it("gives a Manager four screens and More in a bottom bar", async () => {
    await renderPhone("Manager");
    const nav = screen.getByRole("navigation", { name: "Main" });

    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/attendance", "/workers", "/payroll", "/leave"]);
    expect(within(nav).getByRole("link", { name: "Daily Attendance" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Worker Directory" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("gives a Supervisor their three screens and no More", async () => {
    await renderPhone("Supervisor", "sup.omar");
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/attendance",
      "/workers",
      "/leave",
    ]);
    expect(within(nav).queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });

  it("marks the current screen in the bottom bar", async () => {
    await renderPhone("Manager", "mgr.sam", "/workers");

    expect(screen.getByRole("link", { name: "Worker Directory" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Daily Attendance" })).not.toHaveAttribute("aria-current");
  });

  it("replaces the desktop header buttons with a slim bar and an account menu", async () => {
    await renderPhone("Manager");

    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("heading", { name: "Gulf Glass LLC" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Logged in as/)).not.toBeInTheDocument();
  });

  it("falls back to the built-in company name until settings load", async () => {
    vi.mocked(settingsApi.getPayrollSettings).mockReturnValue(new Promise(() => {}));
    await renderPhone("Manager");

    expect(within(screen.getByRole("banner")).getByRole("heading", { name: COMPANY_NAME })).toBeInTheDocument();
  });

  it("opens the other screens from the More sheet and closes it after choosing one", async () => {
    await renderPhone("Manager");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog", { name: "More" });
    expect(within(sheet).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Deductions", "/deductions"],
      ["User Manager", "/users"],
      ["Settings", "/settings"],
    ]);

    await user.click(within(sheet).getByRole("link", { name: "Deductions" }));

    expect(await screen.findByText("deductions content")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("highlights More while one of its screens is open", async () => {
    await renderPhone("Manager", "mgr.sam", "/deductions");

    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  it("shows who is signed in in the account menu", async () => {
    await renderPhone("Supervisor", "sup.omar");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    const sheet = await screen.findByRole("dialog", { name: "Account" });
    expect(within(sheet).getByText("Logged in as sup.omar (Supervisor)")).toBeInTheDocument();
  });

  it("signs out from the account menu", async () => {
    await renderPhone("Manager");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Account menu" }));

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("login screen")).toBeInTheDocument();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("opens the change-password dialog from the account menu", async () => {
    await renderPhone("Manager");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Account menu" }));

    await user.click(await screen.findByRole("button", { name: "Change password" }));

    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    expect(within(dialog).getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Account" })).not.toBeInTheDocument();
  });

  it("shows a Manager how many entries wait for approval on the Attendance tab", async () => {
    vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue({
      submittedTotal: 3,
      submitted: [],
      rejectedTotal: 9,
      rejected: [],
    });
    await renderPhone("Manager");

    expect(await screen.findByRole("link", { name: "Daily Attendance (3 need attention)" })).toBeInTheDocument();
  });

  it("shows a Supervisor how many entries were sent back on the Attendance tab", async () => {
    vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue({
      submittedTotal: 9,
      submitted: [],
      rejectedTotal: 2,
      rejected: [],
    });
    await renderPhone("Supervisor", "sup.omar");

    expect(await screen.findByRole("link", { name: "Daily Attendance (2 need attention)" })).toBeInTheDocument();
  });

  it("keeps the skip link, the routed page and the main landmark", async () => {
    await renderPhone("Manager");

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByText("workers content")).toBeInTheDocument();
  });

  it("switches to the desktop header when the window grows past the breakpoint", async () => {
    const viewport = mockViewport("phone");
    await renderPhone("Manager");
    expect(screen.queryByText(/Logged in as/)).not.toBeInTheDocument();

    act(() => viewport.resize("desktop"));

    expect(await screen.findByText("Logged in as mgr.sam (Manager)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Payroll Summary" })).toBeInTheDocument();
  });
});
