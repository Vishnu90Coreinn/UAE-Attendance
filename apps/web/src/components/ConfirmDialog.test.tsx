import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete worker"
      message="Delete Ahmed Khan permanently?"
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
  it("shows the title, the message and a Cancel and a destructive confirm button", async () => {
    setup();

    const dialog = await screen.findByRole("dialog", { name: "Delete worker" });
    expect(dialog).toHaveAccessibleDescription("Delete Ahmed Khan permanently?");
    expect(within(dialog).getByText("Delete Ahmed Khan permanently?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    expect(confirm.className).toContain("bg-red-600");
    expect(confirm.querySelector("svg")).not.toBeNull();
  });

  it("focuses Cancel first", async () => {
    setup();

    expect(await screen.findByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("calls onConfirm when the confirm button is pressed", async () => {
    const { onConfirm, onCancel, user } = setup();

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on Cancel and on Escape", async () => {
    const { onConfirm, onCancel, user } = setup();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("while pending disables both buttons, shows a spinner and ignores Escape", async () => {
    const { onCancel } = setup({ pending: true });

    const dialog = await screen.findByRole("dialog", { name: "Delete worker" });
    const working = within(dialog).getByRole("button", { name: "Working..." });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute("aria-busy", "true");
    expect(working.querySelector("svg.animate-spin")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("is not shown while closed", () => {
    setup({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
