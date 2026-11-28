import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement, isReadOnly } from "../../permissions";
import { getLeaveBalances, listLeaveTypes, listStaffLeave, type StaffLeave, type StaffLeaveBalanceRow, type StaffLeaveType } from "../../api/staff";
import { Card, CardHeader, LoadingState, PageHeader, cx, sectionLinkClass, sectionNavClass } from "../../ui";
import { LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { BalanceBar } from "./staffKit";
import { LeaveDecisions } from "./LeaveDecisions";
import { LeaveRequestsList } from "./LeaveRequestsList";
import { LeaveTypesTab } from "./LeaveTypesTab";
import { errorText } from "./staffUi";

type Tab = "requests" | "balances" | "types";

/** Under a fifth of the year's days left. */
const isLow = (remaining: number, entitlement: number) => entitlement > 0 && remaining / entitlement < 0.2;

function Balances({ year, rows }: { year: number; rows: StaffLeaveBalanceRow[] }) {
  return (
    <Card>
      <CardHeader title={`Leave balances ${year}`} description="Days used (approved) out of the year's entitlement. Amber marks less than 20% left." />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-600">No office employees yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase text-ink-600">
              <tr>
                <th scope="col" className="px-4 py-3">Employee</th>
                {rows[0].balances.map((b) => <th scope="col" key={b.leaveTypeId} className="px-4 py-3">{b.leaveType}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.workerId} className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block font-medium text-ink-900">{row.name}</span>
                    <span className="block text-xs text-ink-600">{row.code}</span>
                  </th>
                  {row.balances.map((b) => {
                    const low = isLow(b.remaining, b.entitlement);
                    return (
                      <td key={b.leaveTypeId} data-low={low || undefined} className={cx("min-w-32 px-4 py-3", low && "bg-amber-50")}>
                        <p className="mb-1 tabular-nums text-ink-900"><strong>{b.used}</strong> / {b.entitlement} <span className="text-xs text-ink-600">used</span></p>
                        <BalanceBar used={b.used} pending={b.pending} total={b.entitlement} />
                        <p className={cx("mt-1 text-xs tabular-nums", low ? "font-semibold text-amber-900" : "text-ink-600")}>
                          {b.remaining} left{low ? " · low" : ""}{b.pending > 0 ? ` · ${b.pending} pending` : ""}
                        </p>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function StaffLeavePage() {
  const { user } = useAuth();
  const canDecide = isManagement(user?.role);
  const canEditTypes = canDecide && !isReadOnly(user?.role);
  const year = new Date().getFullYear();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: Tab = asked === "balances" ? "balances" : asked === "types" && canEditTypes ? "types" : "requests";
  const [requests, setRequests] = useState<StaffLeave[] | null>(null);
  const [balances, setBalances] = useState<Record<number, StaffLeaveBalanceRow[]>>({});
  const [types, setTypes] = useState<StaffLeaveType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, current, kinds] = await Promise.all([listStaffLeave({}), getLeaveBalances(year), listLeaveTypes()]);
      // A request for another year is decided against that year's balance.
      const others = [...new Set(list.filter((r) => r.status === "Pending").map((r) => Number(r.startDate.slice(0, 4))))].filter((y) => y !== year);
      const extra = await Promise.all(others.map(async (y) => [y, await getLeaveBalances(y)] as const));
      setRequests(list);
      setBalances({ [year]: current, ...Object.fromEntries(extra) });
      setTypes(kinds);
    } catch (e) {
      setError(errorText(e));
    }
  }, [year]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => balances[year] ?? [], [balances, year]);
  const departments = useMemo(() => [...new Set([...rows, ...(requests ?? [])].map((r) => r.department).filter((d): d is string => !!d))].sort(), [rows, requests]);

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!requests) return <LoadingState label="Loading..." />;

  const pending = requests.filter((r) => r.status === "Pending").sort((a, b) => a.createdUtc.localeCompare(b.createdUtc));
  const tabs: [Tab, string][] = [["requests", "Requests"], ["balances", "Balances"], ...(canEditTypes ? [["types", "Leave types"] as [Tab, string]] : [])];

  return (
    <section className="space-y-5 [&_[role=tab]]:min-h-11 [&_input:not([type=checkbox])]:min-h-11 [&_select]:min-h-11">
      <PageHeader title="Staff Leave" description={canDecide ? "Approve or reject leave requested by office employees." : "Leave requests and balances for office employees."} />
      <div role="tablist" aria-label="Staff leave" className={sectionNavClass}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={sectionLinkClass(tab === key)} onClick={() => setParams(key === "requests" ? {} : { tab: key }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>
      <SuccessRegion message={success} />
      {types.length > 0 && types.every((t) => !t.isActive) && tab !== "types" && <p className="text-sm text-amber-800">No leave type is switched on, so employees cannot request leave.</p>}

      <div role="tabpanel" aria-label={tabs.find(([key]) => key === tab)?.[1]} className="space-y-5">
        {tab === "requests" && (
          <>
            {canDecide && (
              <LeaveDecisions
                pending={pending}
                requests={requests}
                balances={balances}
                types={types}
                onDecided={(message) => {
                  setSuccess(message);
                  void load();
                }}
              />
            )}
            <LeaveRequestsList requests={requests} departments={departments} pendingAbove={canDecide} />
          </>
        )}
        {tab === "balances" && <Balances year={year} rows={rows} />}
        {tab === "types" && <LeaveTypesTab types={types} onChanged={() => void load()} />}
      </div>
    </section>
  );
}
