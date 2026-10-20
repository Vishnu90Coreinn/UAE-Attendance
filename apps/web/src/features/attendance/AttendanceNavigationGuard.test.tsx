import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it } from "vitest";
import { AttendanceNavigationGuard } from "./AttendanceNavigationGuard";

it("blocks Back during save and continues automatically when the save succeeds", async () => {
  let finishSave!: () => void;
  function EditingDay() {
    const [dirty, setDirty] = useState(true);
    const [pending, setPending] = useState(true);
    finishSave = () => {
      setDirty(false);
      setPending(false);
    };
    return (
      <>
        <p>Attendance editor</p>
        <AttendanceNavigationGuard dirty={dirty} pending={pending} />
      </>
    );
  }
  const router = createMemoryRouter(
    [
      { path: "/previous", element: <p>Previous page</p> },
      { path: "/attendance", element: <EditingDay /> },
    ],
    { initialEntries: ["/previous", "/attendance"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.navigate(-1);
  });
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Discard unsaved changes?",
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
  await act(async () => finishSave());
  expect(await screen.findByText("Previous page")).toBeInTheDocument();
});
