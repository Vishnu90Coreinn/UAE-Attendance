import { formatDisplayDate } from "../../utils/date";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getLeaveBalances, type LeaveTypeBalance, type WorkerLeaveBalance } from "../../api/leave";

const TYPES = ["Annual Leave", "Sick Leave", "Emergency Leave"] as const;

function Balance({ balance }: { balance: LeaveTypeBalance | undefined }) {
  if (!balance) return <>-</>;
  if (!balance.available)
    return (
      <span className="text-ink-600">
        {balance.eligibleFrom ? `From ${balance.eligibleFrom}` : "Needs a join date"}
      </span>
    );
  return (
    <span className="tabular-nums">
      <strong className="font-semibold text-ink-800">{balance.remaining}</strong>
      <span className="text-ink-600"> left · {balance.used} of {balance.allowance} used</span>
    </span>
  );
}

/** Paid-leave allowances (30 annual after 10 months, 15 sick, 5 emergency) per active worker, counted from attendance. */
export function LeaveBalances({ refreshKey, compact = false }: { refreshKey?: number; compact?: boolean }) {
  const [rows, setRows] = useState<WorkerLeaveBalance[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.resolve(getLeaveBalances())
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (failed) return <p className="text-sm text-ink-600">Leave balances could not be loaded.</p>;
  if (!rows || rows.length === 0) return null;

  if (compact) {
    return (
      <section aria-labelledby="leave-balances-heading" className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
        <h3 id="leave-balances-heading">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
          >
            <span>
              <span className="block text-base font-semibold text-ink-900">Leave balances</span>
              <span className="block text-sm font-normal text-ink-600">Paid days left this year, per worker</span>
            </span>
            <ChevronDown aria-hidden="true" size={20} className={`shrink-0 text-ink-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </h3>
        {open && (
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {rows.map((row) => (
              <li key={row.workerId} aria-label={row.workerName} className="px-4 py-3">
                <p className="text-base font-semibold text-ink-900">{row.workerName}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  {TYPES.map((type) => {
                    const balance = row.balances.find((b) => b.leaveType === type);
                    return (
                      <div key={type} className="flex flex-col-reverse items-center rounded-2xl bg-ink-50 px-1 py-2 text-center">
                        <dt className="text-xs font-medium text-ink-700">{type.replace(" Leave", "")}</dt>
                        <dd className="text-lg font-bold leading-tight tabular-nums text-ink-900">
                          {balance?.available ? balance.remaining : "–"}
                          {balance?.available ? (
                            <span className="block text-[0.6875rem] font-normal text-ink-600">of {balance.allowance}</span>
                          ) : (
                            <span className="block text-[0.6875rem] font-normal text-ink-600">{balance?.eligibleFrom ? `from ${balance.eligibleFrom}` : "no join date"}</span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="leave-balances-heading" className="space-y-2">
      <div>
        <h3 id="leave-balances-heading" className="text-lg font-semibold text-ink-800">
          Leave balances
        </h3>
        <p className="text-sm text-ink-600">
          Paid days per year from each worker's join date: 30 annual (after 10 months), 15 sick and 5 emergency. Paid
          leave counts as a working day at the standard shift; days beyond the allowance are unpaid.
        </p>
      </div>
      <div className="max-w-full overflow-x-auto rounded-card border border-line bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Paid leave balances</caption>
          <thead className="border-b border-line bg-ink-50 text-xs uppercase tracking-wide text-ink-600">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">Worker</th>
              <th scope="col" className="px-3 py-3 font-semibold">Joined</th>
              {TYPES.map((type) => (
                <th key={type} scope="col" className="px-3 py-3 font-semibold">{type}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.workerId} className="border-t border-line">
                <th scope="row" className="px-3 py-3 font-medium text-ink-800">
                  {row.workerName}
                  <span className="block text-xs font-normal text-ink-600">{row.workerCode}</span>
                </th>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{row.joinDate ? formatDisplayDate(row.joinDate) : "-"}</td>
                {TYPES.map((type) => (
                  <td key={type} className="whitespace-nowrap px-3 py-3">
                    <Balance balance={row.balances.find((b) => b.leaveType === type)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
