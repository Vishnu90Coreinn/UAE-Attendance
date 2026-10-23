import { useEffect, useState } from "react";
import { getLeaveBalances, type LeaveTypeBalance, type WorkerLeaveBalance } from "../../api/leave";

const TYPES = ["Annual Leave", "Sick Leave", "Emergency Leave"] as const;

function Balance({ balance }: { balance: LeaveTypeBalance | undefined }) {
  if (!balance) return <>-</>;
  if (!balance.available)
    return (
      <span className="text-gray-600">
        {balance.eligibleFrom ? `From ${balance.eligibleFrom}` : "Needs a join date"}
      </span>
    );
  return (
    <span className="tabular-nums">
      <strong className="font-semibold text-gray-800">{balance.remaining}</strong>
      <span className="text-gray-600"> left · {balance.used} of {balance.allowance} used</span>
    </span>
  );
}

/** Paid-leave allowances (30 annual after 10 months, 15 sick, 5 emergency) per active worker, counted from attendance. */
export function LeaveBalances({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<WorkerLeaveBalance[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  if (failed) return <p className="text-sm text-gray-600">Leave balances could not be loaded.</p>;
  if (!rows || rows.length === 0) return null;

  return (
    <section aria-labelledby="leave-balances-heading" className="space-y-2">
      <div>
        <h3 id="leave-balances-heading" className="text-lg font-semibold text-gray-800">
          Leave balances
        </h3>
        <p className="text-sm text-gray-600">
          Paid days per year from each worker's join date: 30 annual (after 10 months), 15 sick and 5 emergency. Paid
          leave counts as a working day at the standard shift; days beyond the allowance are unpaid.
        </p>
      </div>
      <div className="max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Paid leave balances</caption>
          <thead className="border-b border-gray-200 bg-gray-50">
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
              <tr key={row.workerId} className="border-t border-gray-100">
                <th scope="row" className="px-3 py-3 font-medium text-gray-800">
                  {row.workerName}
                  <span className="block text-xs font-normal text-gray-600">{row.workerCode}</span>
                </th>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{row.joinDate ?? "-"}</td>
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
