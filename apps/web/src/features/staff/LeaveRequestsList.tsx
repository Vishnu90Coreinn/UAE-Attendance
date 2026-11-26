import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { getStaffLeaveFile, type StaffLeave, type StaffLeaveExportFilters } from "../../api/staff";
import { Card, CardHeader, Input, Pager, RowMenu, Select, SortTh, StatusBadge, usePaging, useSort, type StatusTone } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure } from "../workers/WorkersFeedback";
import { DocumentButton } from "./LeaveDocument";
import { Avatar } from "./staffKit";
import { leaveDates, leaveDay } from "./leaveFormat";
import { errorText } from "./staffUi";

const STATUS_TONE: Record<StaffLeave["status"], StatusTone> = { Pending: "warning", Approved: "success", Rejected: "danger", Cancelled: "neutral" };
const NO_FILTERS = { search: "", status: "", department: "", from: "", to: "" };

export function LeaveRequestsList({ requests, departments, pendingAbove }: {
  requests: StaffLeave[];
  departments: string[];
  /** The pending requests are decided in cards above, so the list leaves them out. */
  pendingAbove: boolean;
}) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<typeof NO_FILTERS>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some((v) => v !== "");

  const matching = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return requests
      .filter((r) => !(pendingAbove && r.status === "Pending"))
      .filter((r) => !search || r.name.toLowerCase().includes(search) || r.code.toLowerCase().includes(search))
      .filter((r) => !filters.status || r.status === filters.status)
      .filter((r) => !filters.department || r.department === filters.department)
      // A request is in the range when any of its days is.
      .filter((r) => (!filters.from || r.endDate >= filters.from) && (!filters.to || r.startDate <= filters.to))
      .sort((a, b) => Number(b.status === "Pending") - Number(a.status === "Pending") || b.startDate.localeCompare(a.startDate) || b.id - a.id);
  }, [requests, pendingAbove, filters]);
  const { sorted, sort, toggle } = useSort<StaffLeave>(matching, {
    name: (r) => r.name,
    type: (r) => r.leaveType,
    dates: (r) => r.startDate,
    days: (r) => r.days,
    status: (r) => r.status,
    decided: (r) => r.decidedUtc,
  });
  const paging = usePaging(sorted, 10);
  const { setPage } = paging;
  useEffect(() => setPage(1), [filters, setPage]);

  async function download(format: "pdf" | "excel") {
    setFailure(null);
    const applied: StaffLeaveExportFilters = { status: filters.status || undefined, search: filters.search.trim() || undefined, from: filters.from || undefined, to: filters.to || undefined };
    const year = Number((filters.from || filters.to || `${new Date().getFullYear()}`).slice(0, 4));
    try {
      saveBlob(await getStaffLeaveFile(format, year, filters.department || undefined, applied), `Staff_Leave_${year}.${format === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  const sortable = (label: string, key: string, align?: "right") => (
    <SortTh tall label={label} sortKey={key} sort={sort} onToggle={toggle} align={align} className={`px-4 py-3 font-semibold ${align ? "text-right" : "text-left"}`} />
  );

  return (
    <Card>
      <CardHeader
        title={pendingAbove ? "Decided and cancelled requests" : "All requests"}
        description={pendingAbove ? "The filters apply to this list only, not to the requests waiting above. Export follows them, within one year." : "The filters apply to this list. Export follows them, within one year."}
        actions={
          <RowMenu
            label="Export"
            triggerText="Export"
            triggerIcon={Download}
            triggerClassName="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-semibold text-ink-800 hover:border-brand-600 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            items={[
              { label: "Excel", icon: FileSpreadsheet, onSelect: () => void download("excel") },
              { label: "PDF", icon: FileText, onSelect: () => void download("pdf") },
            ]}
          />
        }
      />
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Search employee" value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Name or code" autoComplete="off" />
        <Select label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All</option>
          {(pendingAbove ? ["Approved", "Rejected", "Cancelled"] : ["Pending", "Approved", "Rejected", "Cancelled"]).map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select label="Department" value={filters.department} onChange={(e) => set({ department: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </Select>
        <Input label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input label="To" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-3 px-5 pb-2 text-sm">
        <p role="status" className="text-ink-600">{sorted.length === 1 ? "1 request" : `${sorted.length} requests`}</p>
        {filtered && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="inline-flex h-11 items-center rounded-lg px-2 font-semibold text-brand-700 underline hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
            Reset filters
          </button>
        )}
      </div>
      {failure && <div className="px-5 pb-3"><ActionFailure message={failure} /></div>}
      {sorted.length === 0 ? (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-600">{filtered ? "No requests match these filters." : "No leave requests."}</p>
      ) : (
        <div className="relative overflow-x-auto border-t border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase text-ink-600">
              <tr>
                {sortable("Employee", "name")}
                {sortable("Type", "type")}
                {sortable("Dates", "dates")}
                <th scope="col" aria-sort={sort?.key === "days" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title="Excludes weekends and holidays" className="px-4 py-3 text-right font-semibold">
                  <button type="button" onClick={() => toggle("days")} className="min-h-11 uppercase underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                    Working days<span className="sr-only"> (excludes weekends and holidays)</span>
                  </button>
                </th>
                {sortable("Status", "status")}
                <th scope="col" className="px-4 py-3 font-semibold">Reason</th>
                {sortable("Decided by / date", "decided")}
              </tr>
            </thead>
            <tbody>
              {paging.pageRows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <div className="whitespace-nowrap font-medium text-ink-900">{r.name}</div>
                        <div className="whitespace-nowrap font-mono text-xs text-ink-600">{r.code}{r.department ? ` · ${r.department}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2">{r.leaveType}</td>
                  <td className="px-4 py-2">{leaveDates(r.startDate, r.endDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.days}</td>
                  <td className="px-4 py-2"><StatusBadge tone={STATUS_TONE[r.status]} variant="soft">{r.status}</StatusBadge></td>
                  <td className="max-w-xs px-4 py-2 text-ink-700">
                    {r.reason}
                    {r.hasAttachment && <div><DocumentButton id={r.id} own={false} title={`${r.name}, ${r.leaveType}`} /></div>}
                  </td>
                  <td className="px-4 py-2 text-ink-700">
                    {r.decidedBy ? (
                      <>
                        <span className="block whitespace-nowrap">{r.decidedBy}{r.decidedUtc ? ` · ${leaveDay(r.decidedUtc.slice(0, 10))}` : ""}</span>
                        {r.status === "Rejected" && r.decisionNote && <span className="block text-[13px] text-danger">Rejected: {r.decisionNote}</span>}
                        {r.status === "Approved" && r.decisionNote && <span className="block text-[13px] text-ink-600">Note: {r.decisionNote}</span>}
                      </>
                    ) : (
                      <span className="text-ink-500">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={paging.page} pages={paging.pages} total={paging.total} start={paging.start} pageSize={paging.pageSize} onPage={paging.setPage} className="border-t border-line px-5 py-3 [&_button]:size-11" />
    </Card>
  );
}
