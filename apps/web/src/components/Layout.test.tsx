import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

vi.mock("./HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));

function renderLayout() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  it("shows the five module tabs in order, all disabled until their slice is built", () => {
    renderLayout();

    const nav = screen.getByRole("navigation", { name: "Main" });
    const tabs = within(nav).getAllByRole("button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Worker Directory",
      "Daily Attendance",
      "Payroll Summary",
      "Leave Management",
      "User Manager",
    ]);
    tabs.forEach((tab) => expect(tab).toBeDisabled());
  });

  it("renders the routed page and the health chip", () => {
    renderLayout();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("health chip")).toBeInTheDocument();
  });

  it("offers a skip link that targets the main content", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});
