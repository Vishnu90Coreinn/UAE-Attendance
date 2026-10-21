import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

let status: "loading" | "signedOut" | "signedIn" = "signedIn";

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ status, user: null, token: null, login: vi.fn(), logout: vi.fn() }),
}));

function LoginStub() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "none";
  return (
    <div>
      <p>login page</p>
      <p data-testid="from">{from}</p>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginStub />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>home content</p>} />
          <Route path="/workers" element={<p>workers content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  status = "signedIn";
});

describe("ProtectedRoute", () => {
  it("renders the nested route when signed in", () => {
    renderAt("/workers");

    expect(screen.getByText("workers content")).toBeInTheDocument();
  });

  it("shows an accessible loading state while the session is restored", () => {
    status = "loading";
    renderAt("/workers");

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(screen.queryByText("workers content")).not.toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("redirects to /login remembering the original page when signed out", () => {
    status = "signedOut";
    renderAt("/workers");

    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.getByTestId("from")).toHaveTextContent("/workers");
    expect(screen.queryByText("workers content")).not.toBeInTheDocument();
  });
});
