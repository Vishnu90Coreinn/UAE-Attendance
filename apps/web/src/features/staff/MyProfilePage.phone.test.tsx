import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as staffApi from "../../api/staff";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { MyProfilePage } from "./MyProfilePage";

vi.mock("../../api/staff");

const profile = {
  workerId: 1, code: "EMP-001", fullName: "Layla Mansoor", designation: "Office Assistant", department: "Admin", workLocation: "Head office",
  joinDate: "2024-01-15", nationality: "Emirati", emiratesId: "784-1990-1234567-1", passportNumber: "P4231100", phone: "+971 50 123 4567",
  email: "layla@example.com", emergencyContact: null, username: "layla.ux", role: "Employee",
} as unknown as staffApi.StaffProfile;

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  vi.mocked(staffApi.getMyProfile).mockResolvedValue(profile);
});
afterEach(restoreViewport);

describe("My Profile on a phone", () => {
  it("groups the details, with Not recorded for what HR has not entered", async () => {
    render(<MyProfilePage />);

    expect(await screen.findByRole("heading", { name: "Layla Mansoor" })).toBeInTheDocument();
    for (const name of ["Contact", "Identity", "Work", "Sign-in and security"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("layla.ux")).toBeInTheDocument();
  });

  it("hides the Emirates ID and passport until asked", async () => {
    const user = userEvent.setup();
    render(<MyProfilePage />);
    await screen.findByRole("heading", { name: "Layla Mansoor" });

    expect(screen.queryByText("784-1990-1234567-1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show Emirates ID" }));
    expect(screen.getByText("784-1990-1234567-1")).toBeInTheDocument();
  });

  it("opens Change password as a sheet", async () => {
    const user = userEvent.setup();
    render(<MyProfilePage />);

    await user.click(await screen.findByRole("button", { name: "Change password" }));
    expect(screen.getByRole("dialog", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  });
});
