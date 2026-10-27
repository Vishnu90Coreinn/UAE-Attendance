import { useId, useState } from "react";
import { ChevronDown, FileSpreadsheet, Printer } from "lucide-react";
import { ApiError } from "../../api/client";
import { getLeaveExport } from "../../api/leave";
import type { Worker } from "../../api/workers";
import { saveBlob } from "../payroll/downloadPdf";

interface Props {
  workers: Worker[];
  disabled: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}
/** Open by default on a wide screen; collapsed on a phone so the leave list stays the first thing seen. */
function startsOpen() {
  try {
    return window.matchMedia("(min-width: 768px)").matches;
  } catch {
    return true;
  }
}
const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 max-sm:flex-1";

/** Downloads the leave requests of one month, for everyone or a single worker. */
export function LeaveReport({ workers, disabled, onDone, onError }: Props) {
  const [month, setMonth] = useState(currentMonth);
  const [workerId, setWorkerId] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [open, setOpen] = useState(startsOpen);
  const monthId = useId();
  const workerKey = useId();

  async function download(format: "pdf" | "excel") {
    if (exporting || !month) return;
    setExporting(format);
    try {
      const who = workerId ? workers.find((w) => String(w.id) === workerId) : undefined;
      const stem = `Leave_${month}${who ? `_${who.workerCode}` : ""}`;
      saveBlob(
        await getLeaveExport(month, workerId ? Number(workerId) : undefined, format),
        `${stem}.${format === "pdf" ? "pdf" : "xlsx"}`,
      );
      onDone(`Leave report for ${month} downloaded as ${format === "pdf" ? "PDF" : "Excel"}.`);
    } catch (reason) {
      onError(reason instanceof ApiError ? reason.message : "The leave report could not be downloaded. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section aria-labelledby={`${monthId}-title`} className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <h3 id={`${monthId}-title`} className="text-base font-semibold text-gray-800">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${monthId}-body`}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span>
            Monthly leave report
            <span className="block text-sm font-normal text-gray-600">Download every leave request that falls in a month.</span>
          </span>
          <ChevronDown aria-hidden="true" size={18} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </h3>
      <div id={`${monthId}-body`} hidden={!open} className="grid gap-3 px-4 pb-4 sm:grid-cols-[12rem_minmax(0,18rem)_auto] sm:items-end">
        <div>
          <label htmlFor={monthId} className="text-sm font-medium">
            Month
          </label>
          <input
            id={monthId}
            type="month"
            value={month}
            disabled={disabled || exporting !== null}
            onChange={(e) => setMonth(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={workerKey} className="text-sm font-medium">
            Worker
          </label>
          <select
            id={workerKey}
            value={workerId}
            disabled={disabled || exporting !== null}
            onChange={(e) => setWorkerId(e.target.value)}
            className={fieldClass}
          >
            <option value="">All workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.fullName} ({w.workerCode})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled || !month || exporting !== null}
            aria-busy={exporting === "pdf"}
            onClick={() => void download("pdf")}
            className={buttonClass}
          >
            <Printer aria-hidden="true" size={16} />
            {exporting === "pdf" ? "Preparing..." : "Print PDF"}
          </button>
          <button
            type="button"
            disabled={disabled || !month || exporting !== null}
            aria-busy={exporting === "excel"}
            onClick={() => void download("excel")}
            className={buttonClass}
          >
            <FileSpreadsheet aria-hidden="true" size={16} />
            {exporting === "excel" ? "Preparing..." : "Excel"}
          </button>
        </div>
      </div>
    </section>
  );
}
