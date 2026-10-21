import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { LoginPage } from "./LoginPage";

const login = vi.fn();
let status: "loading" | "signedOut" | "signedIn" = "signedOut";

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ status, user: null, token: null, login, logout: vi.fn() }),
}));

function renderLogin(entry: string | { pathname: string; state?: unknown } = "/login") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>home page</p>} />
        <Route path="/workers" element={<p>workers page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(username = "admin", password = "correct horse") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

beforeEach(() => {
  login.mockReset();
  status = "signedOut";
});

describe("LoginPage", () => {
  it("renders the company name, a Sign in heading and labelled fields", () => {
    renderLogin();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    const username = screen.getByLabelText("Username");
    const password = screen.getByLabelText("Password");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(username).toHaveFocus();
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits the credentials and goes to the home page", async () => {
    login.mockResolvedValue(undefined);
    renderLogin();

    await fillAndSubmit();

    expect(login).toHaveBeenCalledWith("admin", "correct horse");
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("returns to the page the user came from", async () => {
    login.mockResolvedValue(undefined);
    renderLogin({ pathname: "/login", state: { from: { pathname: "/workers", search: "", hash: "" } } });

    await fillAndSubmit();

    expect(await screen.findByText("workers page")).toBeInTheDocument();
  });

  it("redirects straight away when already signed in", () => {
    status = "signedIn";
    renderLogin();

    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("shows a pending state and disables the button while signing in", async () => {
    let resolve: () => void = () => undefined;
    login.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderLogin();

    await fillAndSubmit();

    const button = screen.getByRole("button", { name: /Signing in/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    resolve();
    await screen.findByText("home page");
  });

  it.each([
    [401, "Invalid username or password."],
    [423, "Account temporarily locked. Try again later."],
    [429, "Too many attempts. Try again later."],
    [0, "Unable to reach the server."],
  ])("shows the %i message in an alert", async (statusCode, message) => {
    login.mockRejectedValue(new ApiError(statusCode, message));
    renderLogin();

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByText("home page")).not.toBeInTheDocument();
  });

  it("moves focus back to the username field after a failure", async () => {
    login.mockRejectedValue(new ApiError(401, "Invalid username or password."));
    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
    expect(screen.getByLabelText("Password")).toHaveValue("wrong password");
  });

  it("shows a generic message for unexpected errors", async () => {
    login.mockRejectedValue(new Error("boom"));
    renderLogin();

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });
});
