import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { SelfieDialog } from "./SelfieDialog";
import * as selfie from "./selfie";

vi.mock("./selfie");

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  vi.mocked(selfie.getPlace).mockResolvedValue({ ok: true, place: { latitude: 1, longitude: 2, accuracyMeters: 10 } });
  vi.mocked(selfie.captureFrame).mockReturnValue("abc");
});
afterEach(() => {
  restoreViewport();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
});

function withCamera() {
  vi.mocked(selfie.cameraAvailable).mockReturnValue(true);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    configurable: true,
  });
}

describe("SelfieDialog on a phone", () => {
  it("shows the photo for a look before anything is sent, and Retake goes back to the camera", async () => {
    withCamera();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<SelfieDialog kind="In" onCancel={vi.fn()} onConfirm={onConfirm} />);
    const video = await screen.findByLabelText("Camera preview");
    video.dispatchEvent(new Event("playing"));

    await userEvent.click(await screen.findByRole("button", { name: "Take photo" }));
    expect(screen.getByAltText("Your selfie")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Retake/ }));
    expect(screen.queryByAltText("Your selfie")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Use photo and sign in" }));
    expect(onConfirm).toHaveBeenCalledWith("abc", expect.objectContaining({ ok: true }));
  });

  it("offers Try again when the camera is blocked", async () => {
    vi.mocked(selfie.cameraAvailable).mockReturnValue(false);
    render(<SelfieDialog kind="Out" onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/secure/);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});
