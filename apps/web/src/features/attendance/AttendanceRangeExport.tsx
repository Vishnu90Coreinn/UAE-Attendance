import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { getAttendanceRangeExport } from "../../api/attendance";
import { ApiError } from "../../api/client";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, SuccessRegion } from "../workers/WorkersFeedback";

const MAX_DAYS = 62;
const fieldClass =
  "min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 max-sm:flex-1";

function dayCount(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.fieldErrors ? Object.values(error.fieldErrors).flat().join(" ") : error.message;
  return "Something went wrong. Please try again.";
}

/** Download the saved attendance for every day between two dates as one PDF or Excel file, instead of one day at a time. */
export function AttendanceRangeExport({ initialDate }: { initialDate: string }) {
  const [from, setFrom] = useState(initialDate);
  const [to, setTo] = useState(initialDate);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const problem = !from || !to
    ? "Choose a start and an end date."
    : to < from
      ? "The end date must be on or after the start date."
      : dayCount(from, to) > MAX_DAYS
        ? `Choose a range of at most ${MAX_DAYS} days.`
        : null;

  async function download(format: "pdf" | "excel") {
    if (exporting || problem) return;
    setExporting(format);
    setError(null);
    setSuccess(null);
    try {
      saveBlob(
        await getAttendanceRangeExport(from, to, format),
        `Attendance_${from}_to_${to}.${format === "pdf" ? "pdf" : "xlsx"}`,
      );
      setSuccess(
        `Attendance from ${from} to ${to} downloaded as one ${format === "pdf" ? "PDF" : "Excel file"}.`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setExporting(null);
    }
  }

  return (
    <section
      aria-labelledby="range-export-heading"
      className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
    >
      <h2 id="range-export-heading" className="font-medium text-gray-800">
        Download several days at once
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-gray-700 max-sm:flex-1">
          Start date
          <input type="date" value={from} max={initialDate} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-gray-700 max-sm:flex-1">
          End date
          <input type="date" value={to} max={initialDate} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
        </label>
        <div className="flex flex-wrap gap-2 max-sm:w-full" role="group" aria-label="Download the selected days">
          <button type="button" onClick={() => download("pdf")} disabled={!!problem || exporting !== null} aria-busy={exporting === "pdf"} className={buttonClass}>
            <FileText aria-hidden="true" size={16} />
            {exporting === "pdf" ? "Preparing..." : "PDF"}
          </button>
          <button type="button" onClick={() => download("excel")} disabled={!!problem || exporting !== null} aria-busy={exporting === "excel"} className={buttonClass}>
            <FileSpreadsheet aria-hidden="true" size={16} />
            {exporting === "excel" ? "Preparing..." : "Excel"}
          </button>
        </div>
      </div>
      {problem && <p className="text-amber-900">{problem}</p>}
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}
    </section>
  );
}
