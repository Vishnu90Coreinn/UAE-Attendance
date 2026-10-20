import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

function Harness({
  onClose = () => {},
  withInitialFocus = false,
}: {
  onClose?: () => void;
  withInitialFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const secondRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open dialog
      </button>
      <Dialog
        open={open}
        title="Sample title"
        initialFocusRef={withInitialFocus ? secondRef : undefined}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <input aria-label="first" />
        <input aria-label="second" ref={secondRef} />
        <button type="button">inside button</button>
      </Dialog>
    </div>
  );
}

async function openDialog(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: "open dialog" }));
  const dialog = await screen.findByRole("dialog", { name: "Sample title" });
  return { user, dialog };
}

describe("Dialog", () => {
  it("renders nothing visible and no children while closed", () => {
    render(<Harness />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("first")).not.toBeInTheDocument();
  });

  it("opens as a modal named by its title heading", async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAccessibleName("Sample title");
    expect(screen.getByRole("heading", { name: "Sample title" })).toBeInTheDocument();
    expect(screen.getByLabelText("first")).toBeInTheDocument();
  });

  it("focuses the first focusable element when no initial focus target is given", async () => {
    await openDialog();

    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("focuses the initial focus target when one is given", async () => {
    await openDialog({ withInitialFocus: true });

    expect(screen.getByLabelText("second")).toHaveFocus();
  });

  it("calls onClose on Escape and returns focus to the opener", async () => {
    const onClose = vi.fn();
    const { user } = await openDialog({ onClose });

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "open dialog" })).toHaveFocus();
  });

  it("treats the native cancel event as a close request", async () => {
    const onClose = vi.fn();
    const { dialog } = await openDialog({ onClose });

    const event = new Event("cancel", { cancelable: true });
    fireEvent(dialog, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts with fresh content every time it is opened", async () => {
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("first"), "typed");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "open dialog" }));

    expect(await screen.findByLabelText("first")).toHaveValue("");
  });

  it("links an optional description to the dialog", async () => {
    render(
      <Dialog open title="With description" descriptionId="desc" onClose={() => {}}>
        <p id="desc">Some description</p>
      </Dialog>,
    );

    expect(await screen.findByRole("dialog", { name: "With description" })).toHaveAccessibleDescription(
      "Some description",
    );
  });
});
