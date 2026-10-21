import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, setAuthToken } from "../api/client";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import { AuthProvider, TOKEN_STORAGE_KEY, useAuth } from "./AuthContext";

vi.mock("../api/auth");

const admin = { id: 1, username: "admin", role: "Administrator" as const };

function Probe() {
  const { status, user, token, login, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user ? `${user.username} (${user.role})` : "none"}</p>
      <p data-testid="token">{token ?? "none"}</p>
      <button onClick={() => login("admin", "pw").catch(() => undefined)}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(authApi.login).mockResolvedValue({
    token: "tok-1",
    expiresUtc: "2026-10-20T20:00:00Z",
    user: admin,
  });
  vi.mocked(authApi.getMe).mockResolvedValue(admin);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  setAuthToken(null);
});

describe("AuthProvider", () => {
  it("starts signed out when nothing is stored", () => {
    renderProvider();

    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
    expect(authApi.getMe).not.toHaveBeenCalled();
  });

  it("login stores the token, mirrors it to sessionStorage and signs in", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(authApi.login).toHaveBeenCalledWith("admin", "pw");
    expect(screen.getByTestId("user")).toHaveTextContent("admin (Administrator)");
    expect(screen.getByTestId("token")).toHaveTextContent("tok-1");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("tok-1");
  });

  it("login failure leaves the user signed out and rethrows", async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(401, "Invalid username or password."));
    let captured: ReturnType<typeof useAuth> | undefined;
    function Capture() {
      captured = useAuth();
      return null;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );

    await expect(captured!.login("admin", "bad")).rejects.toThrow("Invalid username or password.");

    expect(captured!.status).toBe("signedOut");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("logout clears the state and the stored token", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));

    await user.click(screen.getByText("logout"));

    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("token")).toHaveTextContent("none");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("restores a stored token by validating it with getMe", async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
    renderProvider();

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(authApi.getMe).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user")).toHaveTextContent("admin (Administrator)");
    expect(screen.getByTestId("token")).toHaveTextContent("stored-tok");
  });

  it("sends the restored token with API calls", async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-tok");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));

    await apiGet("/api/thing");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer stored-tok" });
  });

  it("discards a stored token the server rejects", async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "stale-tok");
    vi.mocked(authApi.getMe).mockRejectedValue(new ApiError(401, "Unauthorized"));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("token")).toHaveTextContent("none");
  });

  it("signs out when any API call later returns 401", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    );

    await act(async () => {
      await apiGet("/api/thing").catch(() => undefined);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("still works when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    vi.restoreAllMocks();
  });
});
