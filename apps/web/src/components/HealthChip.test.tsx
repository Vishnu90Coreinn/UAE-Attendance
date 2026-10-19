import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getHealth } from "../api/health";
import { HealthChip } from "./HealthChip";

vi.mock("../api/health", () => ({ getHealth: vi.fn() }));

const getHealthMock = vi.mocked(getHealth);

beforeEach(() => {
  getHealthMock.mockReset();
});

describe("HealthChip", () => {
  it("shows a checking state while the request is pending", () => {
    getHealthMock.mockReturnValue(new Promise(() => {}));

    render(<HealthChip />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking");
  });

  it("shows API and database OK when healthy", async () => {
    getHealthMock.mockResolvedValue({ status: "ok", database: "ok" });

    render(<HealthChip />);

    expect(await screen.findByText("API OK · Database OK")).toBeInTheDocument();
  });

  it("shows the database as unreachable when the API reports degraded", async () => {
    getHealthMock.mockResolvedValue({ status: "degraded", database: "unreachable" });

    render(<HealthChip />);

    expect(await screen.findByText("API OK · Database unreachable")).toBeInTheDocument();
  });

  it("shows the API as unreachable when the request fails", async () => {
    getHealthMock.mockRejectedValue(new ApiError(0, "Unable to reach the server."));

    render(<HealthChip />);

    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });
});
