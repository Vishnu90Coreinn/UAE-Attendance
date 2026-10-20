import { beforeEach, expect, it, vi } from "vitest";
import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from "./users";

vi.mock("./client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("uses the authenticated user administration endpoints", async () => {
  await listUsers();
  expect(apiGet).toHaveBeenCalledWith("/api/users");
  await createUser({ username: "new.user", password: "Strong-password-42", role: "Viewer" });
  expect(apiPost).toHaveBeenCalledWith("/api/users", {
    username: "new.user",
    password: "Strong-password-42",
    role: "Viewer",
  });
  await updateUser(7, { role: "HR Staff", active: false });
  expect(apiPut).toHaveBeenCalledWith("/api/users/7", { role: "HR Staff", active: false });
  await resetUserPassword(7, "Replacement-password-42");
  expect(apiPost).toHaveBeenLastCalledWith("/api/users/7/reset-password", {
    password: "Replacement-password-42",
  });
  await deleteUser(7);
  expect(apiDelete).toHaveBeenCalledWith("/api/users/7");
});
