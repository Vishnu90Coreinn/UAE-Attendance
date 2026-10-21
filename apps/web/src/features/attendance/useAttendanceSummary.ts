import { useEffect, useState } from "react";
import {
  getAttendanceSummary,
  type AttendanceSummary,
} from "../../api/attendance";

const CHANGED_EVENT = "attendance-summary-changed";

/** Tell every screen that shows approval counts (the page and the tab badge) to reload them. */
export function announceAttendanceSummaryChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Entries waiting for approval and entries sent back, kept fresh when the page announces a change. */
export function useAttendanceSummary(enabled: boolean): AttendanceSummary | null {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      Promise.resolve()
        .then(() => getAttendanceSummary())
        .then((result) => {
          if (!cancelled && result) setSummary(result);
        })
        .catch(() => {
          // The counts are a convenience; the attendance screen reports its own load failures.
        });
    };
    load();
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, [enabled]);
  return summary;
}
