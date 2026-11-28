import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { Arrive, Draw, Mark } from "./motion";
import { AppToaster, notify } from "./notify";

const underline = (container: HTMLElement) => container.querySelector("[data-mark]");

beforeEach(() => {
  render(<AppToaster />);
});

it("shows content straight away, with its own tag, role and name", () => {
  render(
    <ul>
      <Arrive as="li">AED 1,250.00</Arrive>
      <li>
        <Draw role="img" aria-label="Banks 60%">bar</Draw>
      </li>
    </ul>,
  );
  expect(screen.getByText("AED 1,250.00").tagName).toBe("LI");
  expect(screen.getByRole("img", { name: "Banks 60%" })).toHaveAttribute("data-motion", "draw");
});

it("underlines a figure only once it has changed, without altering what it says", () => {
  const { container, rerender } = render(<Mark value={100}>AED 100.00</Mark>);
  expect(underline(container)).toBeNull();

  rerender(<Mark value={100}>AED 100.00</Mark>);
  expect(underline(container)).toBeNull();

  rerender(<Mark value={75}>AED 75.00</Mark>);
  expect(underline(container)).toHaveAttribute("aria-hidden", "true");
  expect(container).toHaveTextContent(/^AED 75\.00$/);
});

it("says a success in the toaster", async () => {
  act(() => notify.success("EXP-000001 was voided."));
  expect(await screen.findByText("EXP-000001 was voided.")).toBeInTheDocument();
});

it("keeps one copy of a repeated failure, which can be dismissed", async () => {
  act(() => {
    notify.error("The PDF could not be made.");
    notify.error("The PDF could not be made.");
  });
  expect(await screen.findByText("The PDF could not be made.")).toBeInTheDocument();
  expect(screen.getAllByText("The PDF could not be made.")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByText("The PDF could not be made.")).not.toBeInTheDocument());
});
