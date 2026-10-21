import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import * as settingsApi from "../api/settings";
import { COMPANY_NAME } from "../branding";
import { setAuthToken } from "../api/client";
import { AuthProvider, TOKEN_STORAGE_KEY } from "../contexts/AuthContext";
import { Layout } from "./Layout";

vi.mock("../api/auth");
vi.mock("../api/settings");

type TestRole = authApi.CurrentUser["role"];

const MODULES = [
  "Worker Directory",
  "Daily Attendance",
  "Payroll Summary",
  "Deductions",
  "Leave Management",
];

/** Renders the Layout under the real AuthProvider with a restored session for the given role. */
async function renderLayout(
  role: TestRole = "Administrator",
  username = "admin",
  initialPath = "/workers",
) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
  vi.mocked(authApi.getMe).mockResolvedValue({ id: 1, username, role });

  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<Layout />}>
            <Route path="workers" element={<p>page content</p>} />
            <Route path="other" element={<p>other content</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

  await screen.findByText(`Logged in as ${username} (${role})`);
}

function tabLabels() {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return Array.from(nav.querySelectorAll("a, button")).map(
    (tab) => tab.textContent,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({
    companyName: COMPANY_NAME,
    tagline: "Official HR & Payroll System",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 8,
    shiftDescription: "Shift",
    preparedByLabel: "HR",
    approvedByLabel: "GM",
  });
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("Layout", () => {
  it("reads signed-in company branding from payroll settings", async () => {
    vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({
      companyName: "Configured Company",
      tagline: "Configured Tagline",
      contactEmail: "hr@example.com",
      overtimeRatePerHour: 2.22,
      maxBasicHoursPerDay: 8,
      shiftDescription: "Shift",
      preparedByLabel: "HR",
      approvedByLabel: "GM",
    });
    await renderLayout();
    expect(
      await screen.findByRole("heading", { name: "Configured Company" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Configured Tagline")).toBeInTheDocument();
  });
  it("shows the module tabs and Settings in order to an Administrator", async () => {
    await renderLayout("Administrator");

    expect(tabLabels()).toEqual(["Dashboard", ...MODULES, "User Manager", "Settings"]);
  });

  it("renders every built screen as a link", async () => {
    await renderLayout("Administrator");
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Dashboard",
      "Worker Directory",
      "Daily Attendance",
      "Payroll Summary",
      "Deductions",
      "Leave Management",
      "User Manager",
      "Settings",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Worker Directory" }),
    ).toHaveAttribute("href", "/workers");
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      within(nav).getByRole("link", { name: "Daily Attendance" }),
    ).toHaveAttribute("href", "/attendance");
    expect(within(nav).getByRole("link", { name: "User Manager" })).toHaveAttribute("href", "/users");
    expect(
      within(nav).getByRole("link", { name: "Leave Management" }),
    ).toHaveAttribute("href", "/leave");
  });

  it("marks the current page's tab with aria-current and the prototype's blue accent", async () => {
    await renderLayout("Supervisor", "sup.omar", "/workers");

    const link = screen.getByRole("link", { name: "Worker Directory" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("border-blue-500");
    expect(link.className).toContain("text-blue-400");
    expect(link.className).toContain("min-h-11");
  });

  it("does not mark the tab current on another page", async () => {
    await renderLayout("Administrator", "admin", "/other");

    const link = screen.getByRole("link", { name: "Worker Directory" });
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).toContain("border-transparent");
    expect(link.className).not.toContain("border-blue-500");
  });

  it("navigates to the worker directory when its tab is clicked", async () => {
    await renderLayout("Administrator", "admin", "/other");
    const user = userEvent.setup();
    expect(screen.getByText("other content")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Worker Directory" }));

    expect(await screen.findByText("page content")).toBeInTheDocument();
  });

  it("shows a Manager the same tabs as an Administrator", async () => {
    await renderLayout("Manager", "mgr.sam");

    expect(tabLabels()).toEqual(["Dashboard", ...MODULES, "User Manager", "Settings"]);
  });

  it("shows a Supervisor only the three site tabs", async () => {
    await renderLayout("Supervisor", "sup.omar");

    expect(tabLabels()).toEqual([
      "Worker Directory",
      "Daily Attendance",
      "Leave Management",
    ]);
    for (const name of ["Payroll Summary", "User Manager", "Settings"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("shows who is logged in and their role in the header", async () => {
    await renderLayout("Supervisor", "sup.omar");

    const header = screen.getByRole("banner");
    expect(
      within(header).getByText("Logged in as sup.omar (Supervisor)"),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it.each(["Administrator", "Manager"] as const)("shows the User Access header shortcut to %s", async (role) => {
    await renderLayout(role);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "User Access" })).toHaveAttribute("href", "/users");
  });

  it("hides the User Access header shortcut from a Supervisor", async () => {
    await renderLayout("Supervisor");
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "User Access" })).not.toBeInTheDocument();
  });

  it("renders the routed page", async () => {
    await renderLayout();

    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("offers a skip link that targets the main content", async () => {
    await renderLayout();

    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("signs out: clears the session and lands on the login screen", async () => {
    await renderLayout();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("opens the change-password dialog from the header button", async () => {
    await renderLayout();
    const user = userEvent.setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change password" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Change password",
    });
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
  });

  it("returns focus to the Change password button when the dialog is cancelled", async () => {
    await renderLayout();
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Change password" });

    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });
});
