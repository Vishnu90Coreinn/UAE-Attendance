import { render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as usersApi from "../../api/users";
import type { ManagedUser } from "../../api/users";
import { UserPage } from "./UserPage";

vi.mock("../../api/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/users")>()),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  deleteUser: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: 1, username: "admin", role: "Administrator" } }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: auth.user }),
}));

const rows: ManagedUser[] = [
  { id: 1, username: "admin", role: "Administrator", isActive: true, createdUtc: "2026-10-20T10:00:00Z" },
  { id: 2, username: "site.user", role: "Supervisor", isActive: true, createdUtc: "2026-10-20T10:01:00Z" },
];

beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { id: 1, username: "admin", role: "Administrator" };
  vi.mocked(usersApi.listUsers).mockResolvedValue(rows);
});

async function setup() {
  const user = userEvent.setup();
  render(<UserPage />);
  await screen.findByRole("table");
  return user;
}

it("shows the prototype columns and protects the signed-in account", async () => {
  await setup();
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Username", "Role", "Status", "Actions",
  ]);
  const ownRow = screen.getByText("admin").closest("tr")!;
  expect(within(ownRow).getByLabelText("Role for admin")).toBeDisabled();
  expect(within(ownRow).queryByRole("button", { name: "Deactivate admin" })).not.toBeInTheDocument();
  expect(within(ownRow).queryByRole("button", { name: "Delete admin" })).not.toBeInTheDocument();
});

it("offers an Administrator all three roles when adding a user and changing a role", async () => {
  const user = await setup();
  expect(within(screen.getByLabelText("Role for site.user")).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Administrator", "Manager", "Supervisor",
  ]);
  await user.click(screen.getByRole("button", { name: "Add User" }));
  const dialog = screen.getByRole("dialog", { name: "Add User" });
  expect(within(within(dialog).getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Administrator", "Manager", "Supervisor",
  ]);
  expect(within(dialog).getByLabelText("Role")).toHaveValue("Supervisor");
});

it("offers a Manager only the Supervisor role and lists only the accounts the API returns", async () => {
  auth.user = { id: 5, username: "mgr.sam", role: "Manager" };
  vi.mocked(usersApi.listUsers).mockResolvedValue([rows[1]]);
  const user = await setup();
  expect(screen.queryByText("admin")).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("Role for site.user")).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Supervisor",
  ]);
  await user.click(screen.getByRole("button", { name: "Add User" }));
  const dialog = screen.getByRole("dialog", { name: "Add User" });
  const options = within(within(dialog).getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent);
  expect(options).toEqual(["Supervisor"]);
  expect(document.body).not.toHaveTextContent(/HR Staff|Viewer|null|undefined|NaN/);
});

it("adds a user with a visible password-policy hint and server field errors", async () => {
  vi.mocked(usersApi.createUser)
    .mockRejectedValueOnce(new ApiError(400, "Username already exists.", undefined, undefined, { username: ["Username already exists."] }))
    .mockResolvedValueOnce({ ...rows[1], id: 3, username: "new.user", role: "Manager" });
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "Add User" }));
  const dialog = screen.getByRole("dialog", { name: "Add User" });
  expect(within(dialog).getByText(/10 to 128 characters/)).toBeVisible();
  await user.type(within(dialog).getByLabelText("Username"), "new.user");
  await user.type(within(dialog).getByLabelText("Password"), "Strong-password-42");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "Manager");
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));
  expect((await within(dialog).findAllByText("Username already exists."))[0]).toBeVisible();
  expect(within(dialog).getByLabelText("Password")).toHaveValue("Strong-password-42");
  await user.clear(within(dialog).getByLabelText("Username"));
  await user.type(within(dialog).getByLabelText("Username"), "newer.user");
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));
  expect(usersApi.createUser).toHaveBeenLastCalledWith({
    username: "newer.user", password: "Strong-password-42", role: "Manager",
  });
  expect(await screen.findByText("User created.")).toBeVisible();
}, 20000);

it("changes role and status using the latest returned user", async () => {
  vi.mocked(usersApi.updateUser)
    .mockResolvedValueOnce({ ...rows[1], role: "Manager" })
    .mockResolvedValueOnce({ ...rows[1], role: "Manager", isActive: false });
  const user = await setup();
  await user.selectOptions(screen.getByLabelText("Role for site.user"), "Manager");
  expect(usersApi.updateUser).toHaveBeenCalledWith(2, { role: "Manager", active: true });
  await screen.findByText("User role updated.");
  await user.click(screen.getByRole("button", { name: "Deactivate site.user" }));
  expect(usersApi.updateUser).toHaveBeenLastCalledWith(2, { role: "Manager", active: false });
  expect(await screen.findByText("User deactivated.")).toBeVisible();
});

it("resets a password and deletes only after confirmation", async () => {
  vi.mocked(usersApi.resetUserPassword).mockResolvedValue();
  vi.mocked(usersApi.deleteUser).mockResolvedValue();
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "Reset password for site.user" }));
  const reset = screen.getByRole("dialog", { name: "Reset password" });
  await user.type(within(reset).getByLabelText("New password"), "Replacement-password-42");
  await user.click(within(reset).getByRole("button", { name: "Reset password" }));
  expect(usersApi.resetUserPassword).toHaveBeenCalledWith(2, "Replacement-password-42");
  await screen.findByText("Password reset.");

  await user.click(screen.getByRole("button", { name: "Delete site.user" }));
  expect(usersApi.deleteUser).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole("dialog", { name: "Delete user" })).getByRole("button", { name: "Delete" }));
  expect(usersApi.deleteUser).toHaveBeenCalledWith(2);
  expect(await screen.findByText("User deleted.")).toBeVisible();
});

it("retries loading and reloads authoritative state after a conflict", async () => {
  vi.mocked(usersApi.listUsers)
    .mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."))
    .mockResolvedValue(rows);
  const user = userEvent.setup();
  render(<UserPage />);
  await screen.findByText("Unable to reach the server.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table");
  vi.mocked(usersApi.updateUser).mockRejectedValue(new ApiError(409, "At least one active Administrator account is required."));
  await user.selectOptions(screen.getByLabelText("Role for site.user"), "Manager");
  expect(await screen.findByRole("alert")).toHaveTextContent("At least one active Administrator");
  expect(usersApi.listUsers).toHaveBeenCalledTimes(3);
});

it("finishes mutations when React Strict Mode replays effects", async () => {
  vi.mocked(usersApi.createUser).mockResolvedValue({
    ...rows[1], id: 3, username: "strict.user", role: "Manager",
  });
  const user = userEvent.setup();
  render(<StrictMode><UserPage /></StrictMode>);
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: "Add User" }));
  const dialog = screen.getByRole("dialog", { name: "Add User" });
  await user.type(within(dialog).getByLabelText("Username"), "strict.user");
  await user.type(within(dialog).getByLabelText("Password"), "Strict-password-42");
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));
  expect(await screen.findByText("User created.")).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "Add User" })).not.toBeInTheDocument();
});
