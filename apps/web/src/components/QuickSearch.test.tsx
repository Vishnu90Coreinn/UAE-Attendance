import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";
import { navItemsForRole } from "./navItems";
import { QuickSearch } from "./QuickSearch";

const items = navItemsForRole("Administrator");

describe("QuickSearch", () => {
  it("jumps to the chosen screen with the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QuickSearch items={items} />
        <Routes>
          <Route path="/invoices" element={<p>invoices page</p>} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByRole("combobox", { name: "Search screens" }), "invoi{Enter}");
    expect(screen.getByText("invoices page")).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <QuickSearch items={items} />
      </MemoryRouter>,
    );
    await user.type(screen.getByRole("combobox", { name: "Search screens" }), "zzz");
    expect(screen.getByText("No matching screens.")).toBeInTheDocument();
  });
});

describe("Breadcrumbs", () => {
  it("shows the group and screen for the current route", () => {
    render(
      <MemoryRouter initialEntries={["/leave"]}>
        <Breadcrumbs items={items} />
      </MemoryRouter>,
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Pay & leave");
    expect(screen.getByText("Leave Management")).toHaveAttribute("aria-current", "page");
  });

  it("is hidden on the dashboard", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Breadcrumbs items={items} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });
});
