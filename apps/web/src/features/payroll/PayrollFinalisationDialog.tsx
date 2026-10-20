import { useId, useRef, useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import type { PayrollReport } from "../../api/payroll";

interface Props {
  mode: "finalise" | "reopen";
  report: PayrollReport;
  pending: boolean;
  error: string | null;
  stale: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  onReload: () => void;
}
const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const secondary =
  "min-h-11 rounded-lg border border-gray-300 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60";

export function PayrollFinalisationDialog({
  mode,
  report,
  pending,
  error,
  stale,
  onConfirm,
  onClose,
  onReload,
}: Props) {
  const [reason, setReason] = useState("");
  const descriptionId = useId();
  const reasonId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reopening = mode === "reopen";
  const title = reopening ? "Reopen month" : "Finalise month";
  const valid =
    !reopening || (reason.trim().length > 0 && reason.trim().length <= 500);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending && !stale && valid) onConfirm(reason.trim());
  }
  return (
    <Dialog
      open
      title={title}
      onClose={pending ? () => {} : onClose}
      initialFocusRef={cancelRef}
      descriptionId={descriptionId}
    >
      <form onSubmit={submit} className="mt-3 space-y-4">
        <p id={descriptionId} className="text-sm text-gray-700">
          {reopening
            ? `Reopen ${report.period}? Attendance will be editable and the draft will use current worker and overtime rates. The reason is recorded in the audit log.`
            : `Finalise ${report.period}? These figures and company details will be frozen. Attendance for this month will be locked until an Administrator reopens it.`}
        </p>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm tabular-nums">
          <dt>Basic Pay (AED)</dt>
          <dd className="text-right">{money.format(report.totals.basicPay)}</dd>
          <dt>OT Pay (AED)</dt>
          <dd className="text-right">
            {money.format(report.totals.overtimePay)}
          </dd>
          <dt className="font-semibold">Total Net Salary (AED)</dt>
          <dd className="text-right font-semibold">
            {money.format(report.totals.totalPay)}
          </dd>
        </dl>
        {reopening && (
          <div>
            <label htmlFor={reasonId} className="mb-1 block font-medium">
              Reason for reopening
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={500}
              disabled={pending}
              rows={3}
              className="w-full rounded-lg border border-gray-300 p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
            <p className="mt-1 text-sm text-gray-600">
              Required. Up to 500 characters.
            </p>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onClose}
            className={secondary}
          >
            Cancel
          </button>
          {stale && (
            <button
              type="button"
              disabled={pending}
              onClick={onReload}
              className={secondary}
            >
              Reload report
            </button>
          )}
          <button
            type="submit"
            disabled={pending || stale || !valid}
            aria-busy={pending}
            className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Working..." : title}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
