import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as authApi from "./api/auth";
import * as workersApi from "./api/workers";
import { setAuthToken } from "./api/client";
import { AuthProvider, TOKEN_STORAGE_KEY } from "./contexts/AuthContext";

vi.mock("./components/HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));
vi.mock("./api/auth");
vi.mock("./api/workers");

const admin = { id: 1, username: "admin", role: "Administrator" as const };

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function signInWithStoredToken() {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
  vi.mocked(authApi.getMe).mockResolvedValue(admin);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(workersApi.listWorkers).mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("App", () => {
  it("sends a signed-out visit to the root to the login page", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Worker Directory" })).not.toBeInTheDocument();
    expect(screen.queryByText("health chip")).not.toBeInTheDocument();
  });

  it("opens the Worker Directory at the root when signed in", async () => {
    signInWithStoredToken();
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Worker Directory" })).toBeInTheDocument();
    expect(workersApi.listWorkers).toHaveBeenCalledWith(false);
    expect(screen.getByRole("link", { name: "Worker Directory" })).toHaveAttribute("aria-current", "page");
  });

  it("serves the Worker Directory at /workers inside the layout", async () => {
    signInWithStoredToken();
    renderAt("/workers");

    expect(await screen.findByRole("heading", { name: "Worker Directory" })).toBeInTheDocument();
    expect(screen.getByText("health chip")).toBeInTheDocument();
  });

  it("sends a signed-out visit to /workers to the login page", async () => {
    renderAt("/workers");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(workersApi.listWorkers).not.toHaveBeenCalled();
  });

  it("shows a not-found page for unknown routes when signed in", async () => {
    signInWithStoredToken();
    renderAt("/nope");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("redirects a signed-in visit to /login to the Worker Directory", async () => {
    signInWithStoredToken();
    renderAt("/login");

    expect(await screen.findByRole("heading", { name: "Worker Directory" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
