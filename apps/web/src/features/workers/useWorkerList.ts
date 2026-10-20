import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { listWorkers, type Worker } from "../../api/workers";

interface LoadResult {
  /** The filter this result belongs to; a result for another filter counts as still loading. */
  includeInactive: boolean;
  status: "loading" | "ready" | "error";
  workers: Worker[];
  error: string | null;
}

export interface WorkerList {
  status: "loading" | "ready" | "error";
  workers: Worker[];
  error: string | null;
  /** Fetch again, keeping the current rows on screen until the new ones arrive. */
  refresh: () => void;
  /** Fetch again from a clean loading state (after an error). */
  retry: () => void;
}

export function useWorkerList(includeInactive: boolean): WorkerList {
  const [result, setResult] = useState<LoadResult>({ includeInactive, status: "loading", workers: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listWorkers(includeInactive)
      .then((workers) => {
        if (!cancelled) {
          setResult({ includeInactive, status: "ready", workers, error: null });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const error = e instanceof ApiError ? e.message : "Unable to load workers.";
          setResult({ includeInactive, status: "error", workers: [], error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [includeInactive, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const retry = useCallback(() => {
    setResult((current) => ({ ...current, status: "loading", error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const stale = result.includeInactive !== includeInactive;
  return {
    status: stale ? "loading" : result.status,
    workers: stale ? [] : result.workers,
    error: stale ? null : result.error,
    refresh,
    retry,
  };
}
