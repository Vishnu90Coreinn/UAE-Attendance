import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../../api/auth";
import { ApiError } from "../../api/client";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

vi.mock("../../api/auth");

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open dialog
      </button>
      <ChangePasswordDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "open dialog" }));
  const dialog = await screen.findByRole("dialog", { name: "Change password" });
  return { user, dialog };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  { current = "old-password-1", next = "brand-new-pass", confirm = next }: { current?: string; next?: string; confirm?: string } = {},
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
}

function save(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Save password" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.changePassword).mockResolvedValue(undefined);
});

describe("ChangePasswordDialog", () => {
  it("renders a labelled modal with three password fields and the right autocomplete hints", async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAccessibleName("Change password");
    const current = within(dialog).getByLabelText("Current password");
    const next = within(dialog).getByLabelText("New password");
    const confirm = within(dialog).getByLabelText("Confirm new password");
    [current, next, confirm].forEach((field) => expect(field).toHaveAttribute("type", "password"));
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(next).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
    expect(next).toHaveAccessibleDescription("At least 10 characters");
    expect(current).toHaveFocus();
  });

  it("rejects a too-short new password on blur, under the field and in an alert, without calling the API", async () => {
    const { user, dialog } = await openDialog();

    await user.type(screen.getByLabelText("New password"), "short");
    await user.tab();

    const next = screen.getByLabelText("New password");
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(next).toHaveAccessibleDescription(/New password must be at least 10 characters\./);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("New password must be at least 10 characters.");

    await user.type(screen.getByLabelText("Current password"), "old-password-1");
    await user.type(screen.getByLabelText("Confirm new password"), "short");
    await save(user);
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("rejects a new password longer than 128 characters", async () => {
    const { user } = await openDialog();

    await user.click(screen.getByLabelText("New password"));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a".repeat(129) } });
    await user.tab();

    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /New password must be at most 128 characters\./,
    );
  });

  it("rejects a mismatched confirmation on submit and blocks the request", async () => {
    const { user, dialog } = await openDialog();

    await fill(user, { next: "brand-new-pass", confirm: "brand-new-pasX" });
    await save(user);

    const confirm = screen.getByLabelText("Confirm new password");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("The confirmation does not match the new password.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The confirmation does not match the new password.");
    expect(confirm).toHaveFocus();
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("asks for the current password when it is empty", async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText("New password"), "brand-new-pass");
    await user.type(screen.getByLabelText("Confirm new password"), "brand-new-pass");
    await save(user);

    expect(screen.getByLabelText("Current password")).toHaveAccessibleDescription("Enter your current password.");
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("calls changePassword once with the current and new passwords and shows a success status", async () => {
    const { user } = await openDialog();

    await fill(user, { current: "old-password-1", next: "brand-new-pass" });
    await save(user);

    expect(authApi.changePassword).toHaveBeenCalledTimes(1);
    expect(authApi.changePassword).toHaveBeenCalledWith("old-password-1", "brand-new-pass");
    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed.");
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("shows a disabled Saving... button while the request is pending", async () => {
    let resolve!: () => void;
    vi.mocked(authApi.changePassword).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const { user } = await openDialog();

    await fill(user);
    await save(user);

    const pending = screen.getByRole("button", { name: "Saving..." });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    await act(async () => resolve());
    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed.");
  });

  it("maps server field errors to the matching fields", async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(
      new ApiError(400, "Current password is incorrect.", undefined, undefined, {
        currentPassword: ["Current password is incorrect."],
        newPassword: ["New password must be different from the current password."],
      }),
    );
    const { user, dialog } = await openDialog();

    await fill(user);
    await save(user);

    expect(await screen.findByLabelText("Current password")).toHaveAccessibleDescription(
      "Current password is incorrect.",
    );
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /New password must be different from the current password\./,
    );
    expect(screen.getByLabelText("Confirm new password")).not.toHaveAttribute("aria-invalid", "true");
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent("Current password is incorrect.");
    expect(alert).toHaveTextContent("New password must be different from the current password.");
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
    expect(screen.getByLabelText("Current password")).toHaveFocus();
  });

  it("clears a server error once the user edits that field", async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(
      new ApiError(400, "Current password is incorrect.", undefined, undefined, {
        currentPassword: ["Current password is incorrect."],
      }),
    );
    const { user } = await openDialog();
    await fill(user);
    await save(user);
    await screen.findByText("Current password is incorrect.", { selector: "p[id]" });

    await user.type(screen.getByLabelText("Current password"), "x");

    expect(screen.getByLabelText("Current password")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows a general failure (for example the server being unreachable) in the alert", async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    const { user, dialog } = await openDialog();

    await fill(user);
    await save(user);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unable to reach the server.");
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
  });

  it("closes on Escape and returns focus to the button that opened it", async () => {
    const { user } = await openDialog();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "open dialog" })).toHaveFocus();
  });

  it("closes on Cancel, even after typing, and returns focus to the opener", async () => {
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Current password"), "abc");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "open dialog" })).toHaveFocus();
  });

  it("closes from the success state with Close", async () => {
    const { user } = await openDialog();
    await fill(user);
    await save(user);

    await user.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "open dialog" })).toHaveFocus();
  });

  it("clears the fields and any errors when reopened", async () => {
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Current password"), "secret-old");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "open dialog" }));

    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    expect(within(dialog).getByLabelText("Current password")).toHaveValue("");
    expect(within(dialog).getByLabelText("New password")).toHaveValue("");
    expect(within(dialog).getByLabelText("Confirm new password")).toHaveValue("");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});
