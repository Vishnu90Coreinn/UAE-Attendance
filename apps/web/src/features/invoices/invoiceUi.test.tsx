import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { daysOverdue, InvoiceStatusBadges } from "./invoiceUi";

describe("daysOverdue", () => {
  it("counts whole days past the due date, never below zero", () => {
    expect(daysOverdue("2026-10-01", "2026-10-13")).toBe(12);
    expect(daysOverdue("2026-10-13", "2026-10-13")).toBe(0);
    expect(daysOverdue("2026-10-20", "2026-10-13")).toBe(0);
  });
});

describe("InvoiceStatusBadges", () => {
  it("shows one pill with the status when the invoice is not overdue", () => {
    render(<InvoiceStatusBadges status="Paid" overdue={false} />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });
  it("folds overdue into a single pill", () => {
    const { container } = render(<InvoiceStatusBadges status="Issued" overdue dueDate="2000-01-01" />);
    expect(container.textContent).toMatch(/^Overdue · \d+ days$/);
    expect(screen.queryByText("Issued")).not.toBeInTheDocument();
  });
  it("keeps the part-paid status in the same pill", () => {
    render(<InvoiceStatusBadges status="PartPaid" overdue />);
    expect(screen.getByText("Part-paid · Overdue")).toBeInTheDocument();
  });
});
