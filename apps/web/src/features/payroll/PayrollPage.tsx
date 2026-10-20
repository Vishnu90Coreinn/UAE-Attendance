import { useEffect, useRef, useState } from "react";
import {
  Download,
  LockKeyhole,
  Printer,
  RefreshCw,
  UnlockKeyhole,
} from "lucide-react";
import { ApiError } from "../../api/client";
import {
  getPayroll,
  getPayrollPdf,
  finalisePayroll,
  reopenPayroll,
  type PayrollReport as Report,
} from "../../api/payroll";
import {
  ActionFailure,
  LoadError,
  primaryButtonClass,
  SuccessRegion,
} from "../workers/WorkersFeedback";
import { PayrollReport } from "./PayrollReport";
import { downloadPdf } from "./downloadPdf";
import { PayrollFinalisationDialog } from "./PayrollFinalisationDialog";
import { isManagement } from "../../permissions";
import { useAuth } from "../../contexts/AuthContext";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";
function failure(reason: unknown): string {
  return reason instanceof ApiError
    ? reason.fieldErrors
      ? Object.values(reason.fieldErrors).flat().join(" ")
      : reason.message
    : "Something went wrong. Please try again.";
}

export function PayrollPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [stale, setStale] = useState(false);
  const [dialog, setDialog] = useState<"finalise" | "reopen" | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setSuccess(null);
    setReport(null);
    setStale(false);
    getPayroll(month)
      .then((value) => {
        if (!cancelled) {
          setReport(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setLoadError(failure(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month, attempt]);

  const ready = !!report && !loading && !loadError;
  const busy = exporting || mutating;
  const future = !!report && report.period > currentMonth();
  function openDialog(mode: "finalise" | "reopen") {
    setMutationError(null);
    setSuccess(null);
    setDialog(mode);
  }
  async function changeFinalisation(reason: string) {
    if (!report || !dialog || busy || stale) return;
    setMutating(true);
    setMutationError(null);
    const action = dialog;
    try {
      const updated =
        action === "finalise"
          ? await finalisePayroll(report.period, report.revision)
          : await reopenPayroll(report.period, reason);
      if (!mounted.current) return;
      setReport(updated);
      setDialog(null);
      setError(null);
      setSuccess(
        action === "finalise"
          ? "Payroll month finalised."
          : "Payroll month reopened.",
      );
    } catch (reason) {
      if (mounted.current) {
        setMutationError(failure(reason));
        if (reason instanceof ApiError && reason.status === 409) setStale(true);
      }
    } finally {
      if (mounted.current) setMutating(false);
    }
  }
  async function exportPdf() {
    if (!report || !ready || stale || busy || dialog) return;
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const blob = await getPayrollPdf(report.period, report.revision);
      if (!mounted.current) return;
      downloadPdf(blob, report.period);
      setSuccess("PDF downloaded.");
    } catch (reason) {
      if (mounted.current) {
        setError(failure(reason));
        if (reason instanceof ApiError && reason.status === 409) setStale(true);
      }
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  function print() {
    if (!ready || stale || busy || dialog) return;
    try {
      window.print();
    } catch (reason) {
      setError(failure(reason));
    }
  }

  return (
    <section className="payroll-page min-w-0 space-y-4">
      <div className="payroll-controls space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Payroll Summary</h2>
          <p className="mt-1 text-sm text-gray-600">
            Review monthly pay, then print or export the report.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label
              htmlFor="payroll-month"
              className="mb-1 block text-sm font-medium text-gray-800"
            >
              Payroll month
            </label>
            <input
              type="month"
              id="payroll-month"
              value={month}
              disabled={busy || !!dialog}
              onChange={(event) => {
                if (event.target.value) setMonth(event.target.value);
              }}
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              disabled={loading || busy || !!dialog}
              className={secondaryButtonClass}
            >
              <RefreshCw aria-hidden="true" size={16} />
              Reload report
            </button>
            <button
              type="button"
              onClick={print}
              disabled={!ready || stale || busy || !!dialog}
              className={secondaryButtonClass}
            >
              <Printer aria-hidden="true" size={16} />
              Print
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={!ready || stale || busy || !!dialog}
              aria-busy={exporting}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Download aria-hidden="true" size={16} />
              {exporting ? "Exporting..." : "Export PDF"}
            </button>
            {isManagement(user?.role) && (
              <button
                type="button"
                onClick={() =>
                  openDialog(
                    report?.status === "Finalised" ? "reopen" : "finalise",
                  )
                }
                disabled={
                  !ready ||
                  stale ||
                  busy ||
                  !!dialog ||
                  (report?.status !== "Finalised" && future)
                }
                className={secondaryButtonClass}
              >
                {report?.status === "Finalised" ? (
                  <UnlockKeyhole aria-hidden="true" size={16} />
                ) : (
                  <LockKeyhole aria-hidden="true" size={16} />
                )}
                {report?.status === "Finalised"
                  ? "Reopen month"
                  : "Finalise month"}
              </button>
            )}
          </div>
        </div>
        <SuccessRegion message={success} />
        {error && <ActionFailure message={error} />}
        {report?.status === "Draft" && (
          <p className="text-sm text-gray-600">
            Draft payroll uses current worker and overtime rates. Amounts are in
            AED.
          </p>
        )}
        {future && report?.status === "Draft" && (
          <p className="text-sm text-gray-600">
            Future months cannot be finalised.
          </p>
        )}
        {stale && !dialog && (
          <p className="text-sm text-amber-800">
            Reload the report before continuing.
          </p>
        )}
      </div>
      {loading ? (
        <p role="status" className="payroll-controls py-8 text-gray-600">
          Loading payroll...
        </p>
      ) : loadError ? (
        <div className="payroll-controls">
          <LoadError
            message={loadError}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </div>
      ) : (
        report && <PayrollReport report={report} />
      )}
      {dialog && report && (
        <PayrollFinalisationDialog
          mode={dialog}
          report={report}
          pending={mutating}
          error={mutationError}
          stale={stale}
          onConfirm={changeFinalisation}
          onClose={() => setDialog(null)}
          onReload={() => {
            setDialog(null);
            setAttempt((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
