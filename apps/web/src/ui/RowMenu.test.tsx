import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowMenu } from "./RowMenu";

function setup() {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <RowMenu
      label="More actions for Ahmed"
      items={[
        { label: "Edit", onSelect: onEdit },
        { label: "Delete", danger: true, disabled: true, disabledReason: "Has records", onSelect: onDelete },
      ]}
    />,
  );
  return { user: userEvent.setup(), onEdit, onDelete };
}

describe("RowMenu", () => {
  it("is closed until opened, then lists the actions", async () => {
    const { user } = setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions for Ahmed" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for Ahmed" })).toHaveAttribute("aria-expanded", "true");
  });

  it("runs the chosen action and closes", async () => {
    const { user, onEdit } = setup();
    await user.click(screen.getByRole("button", { name: "More actions for Ahmed" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("never runs a disabled action, and says why", async () => {
    const { user, onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "More actions for Ahmed" }));
    const item = screen.getByRole("menuitem", { name: "Delete" });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "Has records");
    await user.click(item);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to its button", async () => {
    const { user } = setup();
    const button = screen.getByRole("button", { name: "More actions for Ahmed" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More actions for Ahmed" }));
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
