import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Pager, SortTh, usePaging, useSort } from "./DataTable";

const people = [
  { name: "Charlie", age: 30 },
  { name: "alice", age: null as number | null },
  { name: "Bob", age: 25 },
];

function Demo({ rows = people, size = 25 }: { rows?: typeof people; size?: number }) {
  const { sorted, sort, toggle } = useSort(rows, { name: (r) => r.name, age: (r) => r.age });
  const paging = usePaging(sorted, size);
  return (
    <>
      <table>
        <thead>
          <tr>
            <SortTh label="Name" sortKey="name" sort={sort} onToggle={toggle} />
            <SortTh label="Age" sortKey="age" sort={sort} onToggle={toggle} />
          </tr>
        </thead>
        <tbody>
          {paging.pageRows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.age ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...paging} onPage={paging.setPage} />
    </>
  );
}

const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("useSort and SortTh", () => {
  it("cycles ascending, descending, then the original order", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(names()).toEqual(["Charlie", "alice", "Bob"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["alice", "Bob", "Charlie"]);
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Charlie", "Bob", "alice"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Charlie", "alice", "Bob"]);
  });

  it("keeps empty values last in both directions", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Age" }));
    expect(names()).toEqual(["Bob", "Charlie", "alice"]);
    await user.click(screen.getByRole("button", { name: "Age" }));
    expect(names()).toEqual(["Charlie", "Bob", "alice"]);
  });
});

describe("Pager", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `P${i + 1}`, age: i }));

  it("pages through the list", async () => {
    const user = userEvent.setup();
    render(<Demo rows={many} size={2} />);
    expect(names()).toEqual(["P1", "P2"]);
    expect(screen.getByText("Showing 1-2 of 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(names()).toEqual(["P3", "P4"]);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(names()).toEqual(["P5"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("is absent when everything fits", () => {
    render(<Demo />);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });
});
