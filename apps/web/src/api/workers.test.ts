import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import {
  activateWorker,
  createWorker,
  deactivateWorker,
  deleteWorker,
  getNextWorkerCode,
  listWorkers,
  updateWorker,
  type Worker,
  type WorkerInput,
} from "./workers";

vi.mock("./client");

const worker: Worker = {
  id: 3,
  workerCode: "EMP-003",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
  isActive: true,
};

const input: WorkerInput = {
  workerCode: "EMP-003",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("workers api", () => {
  it("lists active workers only by default request", async () => {
    vi.mocked(client.apiGet).mockResolvedValue([worker]);

    await expect(listWorkers(false)).resolves.toEqual([worker]);

    expect(client.apiGet).toHaveBeenCalledWith("/api/workers?includeInactive=false");
  });

  it("lists inactive workers too when asked", async () => {
    vi.mocked(client.apiGet).mockResolvedValue([worker]);

    await listWorkers(true);

    expect(client.apiGet).toHaveBeenCalledWith("/api/workers?includeInactive=true");
  });

  it("reads the next worker code and returns just the code", async () => {
    vi.mocked(client.apiGet).mockResolvedValue({ workerCode: "EMP-005" });

    await expect(getNextWorkerCode()).resolves.toBe("EMP-005");

    expect(client.apiGet).toHaveBeenCalledWith("/api/workers/next-code");
  });

  it("creates a worker with POST", async () => {
    vi.mocked(client.apiPost).mockResolvedValue(worker);

    await expect(createWorker(input)).resolves.toEqual(worker);

    expect(client.apiPost).toHaveBeenCalledWith("/api/workers", input);
  });

  it("updates a worker with PUT on its id", async () => {
    vi.mocked(client.apiPut).mockResolvedValue(worker);

    await expect(updateWorker(3, input)).resolves.toEqual(worker);

    expect(client.apiPut).toHaveBeenCalledWith("/api/workers/3", input);
  });

  it("deactivates and activates with POST on the action routes", async () => {
    vi.mocked(client.apiPost).mockResolvedValue(worker);

    await deactivateWorker(3);
    await activateWorker(3);

    expect(client.apiPost).toHaveBeenNthCalledWith(1, "/api/workers/3/deactivate", undefined);
    expect(client.apiPost).toHaveBeenNthCalledWith(2, "/api/workers/3/activate", undefined);
  });

  it("deletes with DELETE on the worker id", async () => {
    vi.mocked(client.apiDelete).mockResolvedValue(undefined);

    await expect(deleteWorker(3)).resolves.toBeUndefined();

    expect(client.apiDelete).toHaveBeenCalledWith("/api/workers/3");
  });
});
