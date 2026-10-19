import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./components/HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  it("shows the home page at the root", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "Foundation ready" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown routes", () => {
    renderAt("/nope");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
