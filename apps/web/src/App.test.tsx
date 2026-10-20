import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as authApi from "./api/auth";
import { setAuthToken } from "./api/client";
import { AuthProvider, TOKEN_STORAGE_KEY } from "./contexts/AuthContext";

vi.mock("./components/HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));
vi.mock("./api/auth");

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
});

afterEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("App", () => {
  it("sends a signed-out visit to the root to the login page", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Foundation ready" })).not.toBeInTheDocument();
    expect(screen.queryByText("health chip")).not.toBeInTheDocument();
  });

  it("shows the home page at the root when signed in", async () => {
    signInWithStoredToken();
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Foundation ready" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown routes when signed in", async () => {
    signInWithStoredToken();
    renderAt("/nope");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("redirects a signed-in visit to /login to the home page", async () => {
    signInWithStoredToken();
    renderAt("/login");

    expect(await screen.findByRole("heading", { name: "Foundation ready" })).toBeInTheDocument();
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
