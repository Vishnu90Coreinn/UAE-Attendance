import { useEffect, useState } from "react";
import { listLeave } from "../../api/leave";
import { listStaffLeave } from "../../api/staff";

/** Leave requests waiting for a decision, site and office apart, for the navigation badges. Reloads as the screen changes, so a decision shows at once. */
export function useLeaveWaiting(enabled: boolean, screen: string): { leave: number; staffLeave: number } {
  const [counts, setCounts] = useState({ leave: 0, staffLeave: 0 });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // A count is a convenience: if it cannot be read there is simply no badge, and the screen itself reports its failures.
    const size = (load: () => Promise<unknown[]>) =>
      Promise.resolve()
        .then(load)
        .then((list) => list?.length ?? 0)
        .catch(() => 0);
    void Promise.all([size(() => listLeave({ status: "Pending" })), size(() => listStaffLeave({ status: "Pending" }))]).then(([leave, staffLeave]) => {
      if (!cancelled) setCounts({ leave, staffLeave });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, screen]);
  return counts;
}
