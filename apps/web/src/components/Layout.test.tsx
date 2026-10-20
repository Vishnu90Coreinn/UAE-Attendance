import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { setAuthToken } from "../api/client";
import { AuthProvider, TOKEN_STORAGE_KEY } from "../contexts/AuthContext";
import { Layout } from "./Layout";

vi.mock("./HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));
vi.mock("../api/auth");

type TestRole = authApi.CurrentUser["role"];

const MODULES = ["Worker Directory", "Daily Attendance", "Payroll Summary", "Leave Management"];

/** Renders the Layout under the real AuthProvider with a restored session for the given role. */
async function renderLayout(role: TestRole = "Administrator", username = "admin") {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
  vi.mocked(authApi.getMe).mockResolvedValue({ id: 1, username, role });

  render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<Layout />}>
            <Route index element={<p>page content</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

  await screen.findByText(`Logged in as ${username} (${role})`);
}

function tabLabels() {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return within(nav)
    .getAllByRole("button")
    .map((tab) => tab.textContent);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("Layout", () => {
  it("shows the five module tabs in order to an Administrator, all disabled until their slice is built", async () => {
    await renderLayout("Administrator");

    expect(tabLabels()).toEqual([...MODULES, "User Manager"]);
    within(screen.getByRole("navigation", { name: "Main" }))
      .getAllByRole("button")
      .forEach((tab) => expect(tab).toBeDisabled());
  });

  it("hides User Manager from HR Staff", async () => {
    await renderLayout("HR Staff", "hr.jane");

    expect(tabLabels()).toEqual(MODULES);
  });

  it("hides User Manager from a Viewer", async () => {
    await renderLayout("Viewer", "view.only");

    expect(tabLabels()).toEqual(MODULES);
  });

  it("shows who is logged in and their role in the header", async () => {
    await renderLayout("HR Staff", "hr.jane");

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Logged in as hr.jane (HR Staff)")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("renders the routed page and the health chip", async () => {
    await renderLayout();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("health chip")).toBeInTheDocument();
  });

  it("offers a skip link that targets the main content", async () => {
    await renderLayout();

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
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

    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
  });

  it("returns focus to the Change password button when the dialog is cancelled", async () => {
    await renderLayout();
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Change password" });

    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
