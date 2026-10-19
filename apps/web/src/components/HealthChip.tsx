import { useEffect, useState } from "react";
import { getHealth } from "../api/health";

type HealthState = "checking" | "ok" | "database-down" | "offline";

const LABELS: Record<HealthState, string> = {
  checking: "Checking…",
  ok: "API OK · Database OK",
  "database-down": "API OK · Database unreachable",
  offline: "API unreachable",
};

const DOT_COLOURS: Record<HealthState, string> = {
  checking: "bg-slate-400",
  ok: "bg-green-400",
  "database-down": "bg-amber-400",
  offline: "bg-red-500",
};

export function HealthChip() {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then((health) => setState(health.database === "ok" ? "ok" : "database-down"))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("offline");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT_COLOURS[state]}`} />
      {LABELS[state]}
    </span>
  );
}
