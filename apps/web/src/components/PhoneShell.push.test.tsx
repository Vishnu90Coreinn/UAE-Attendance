import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { PhoneShell } from "./PhoneShell";

const toggle = vi.fn();
vi.mock("../usePushToggle", () => ({
  usePushToggle: () => ({ state: "off", busy: false, toggle, label: "Turn on notifications", visible: true }),
}));

it("offers Turn on notifications in the phone account sheet", async () => {
  render(
    <MemoryRouter>
      <PhoneShell
        companyName="Co"
        user={{ id: 1, username: "sup1", role: "Supervisor" }}
        attendanceAttention={0}
        onChangePassword={() => undefined}
        onSignOut={() => undefined}
      >
        <p>page</p>
      </PhoneShell>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
  expect(toggle).toHaveBeenCalledTimes(1);
});
