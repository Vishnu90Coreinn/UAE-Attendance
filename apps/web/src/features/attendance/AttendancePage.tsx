import { useEffect, useState } from "react";
import { LoadingState, PageHeader, RowMenu, buttonClass } from "../../ui";
import { Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Download, FileSpreadsheet, FileText, Save } from "lucide-react";
import {
  approveAttendance,
  getAttendance,
  getAttendanceExport,
  rejectAttendance,
  saveAttendance,
  type AttendanceDay,
  type AttendanceRow,
} from "../../api/attendance";
import { ApiError } from "../../api/client";
import { isLeaveStatus } from "../../utils/leaveStatuses";
import { getPayrollSettings, type PayrollSettings } from "../../api/settings";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { canViewAll, isManagement, isReadOnly } from "../../permissions";
import { useAuth } from "../../contexts/AuthContext";
import { useIsDesktop } from "../../utils/useIsDesktop";
import {
  ActionFailure,
  LoadError,
  primaryButtonClass,
  SuccessRegion,
} from "../workers/WorkersFeedback";
import { saveBlob } from "../payroll/downloadPdf";
import { AttendanceList } from "./AttendanceList";
import { AttendanceCards } from "./AttendanceCards";
import { PhoneToast } from "../../components/PhoneToast";
import { PAGE_GAP, phoneButton } from "../../components/phoneUi";
import { PhoneHeader, PhoneSaveBar, PhoneSummary } from "./AttendancePhoneChrome";
import type { AttendanceFilter } from "./attendanceFilter";
import { AttendanceRangeExport } from "./AttendanceRangeExport";
import { AttendanceTable } from "./AttendanceTable";
import { RejectDialog } from "./RejectDialog";
import {
  announceAttendanceSummaryChanged,
  useAttendanceSummary,
} from "./useAttendanceSummary";
import { AttendanceNavigationGuard } from "./AttendanceNavigationGuard";
import {
  changed,
  formFromRow,
  formInput,
  previewPay,
  validateHours,
  type AttendanceForm,
} from "./attendanceForm";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
/** The date one or more days before or after `value` (both yyyy-MM-dd). */
function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const dayButtonClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-ink-300 bg-white text-ink-800 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-40";
function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.fieldErrors
      ? Object.values(error.fieldErrors).flat().join(" ")
      : error.message;
  return "Something went wrong. Please try again.";
}

export function AttendancePage({
  guardNavigation = false,
}: {
  guardNavigation?: boolean;
}) {
  const { user } = useAuth();
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [forms, setForms] = useState<AttendanceForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [nextDate, setNextDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [rejecting, setRejecting] = useState<AttendanceRow | null>(null);
  // Phone only: narrow the list to one state, and remember what "mark all present" overwrote so it can be undone.
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [undo, setUndo] = useState<{ forms: AttendanceForm[]; label: string } | null>(null);
  const summary = useAttendanceSummary(!!user);
  const isManager = isManagement(user?.role);
  const showPay = canViewAll(user?.role);
  const editable = !!user && user.role !== "HR" && !isReadOnly(user.role) && !day?.isFinalised;
  const unsaved = day ? forms.filter((form, index) => changed(form, day.rows[index])).length : 0;
  const dirty = unsaved > 0;
  const present = forms.filter((form) => form.status === "Present").length;
  const absent = forms.filter((form) => form.status === "Absent").length;
  const onLeave = forms.filter((form) => isLeaveStatus(form.status)).length;
  const notRecorded = forms.length - present - absent - onLeave;
  const totalPay =
    showPay && day && settings
      ? day.rows.reduce(
          (sum, row, index) =>
            sum + (previewPay(row, forms[index], settings.maxBasicHoursPerDay, settings.overtimeRatePerHour) ?? 0),
          0,
        )
      : null;
  const markableCount = day
    ? day.rows.filter(
        (row, index) => forms[index]?.status === null && (isManager || row.record?.approvalStatus !== "Approved"),
      ).length
    : 0;
  const canMarkAll = editable && markableCount > 0;
  const isDesktop = useIsDesktop();
  const List = isDesktop ? AttendanceTable : AttendanceCards;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setSuccess(null);
    setFilter("all");
    setUndo(null);
    Promise.all([getAttendance(date), getPayrollSettings()])
      .then(([result, config]) => {
        if (!cancelled) {
          setDay(result);
          setSettings(config);
          setForms(result.rows.map(formFromRow));
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setLoadError(errorMessage(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  // The undo offer is a passing toast, not a permanent fixture of the bar.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function change(workerId: number, patch: Partial<AttendanceForm>) {
    setForms((current) =>
      current.map((form) =>
        form.workerId === workerId ? { ...form, ...patch } : form,
      ),
    );
    setSuccess(null);
    setError(null);
    setUndo(null);
  }
  /** Sets every worker who has no status yet to Present (on the standard shift) or Absent; recorded workers are left alone. */
  function markRemaining(status: "Present" | "Absent") {
    if (!day || !settings) return;
    setUndo({ forms, label: `Marked ${markableCount} ${status === "Present" ? "present" : "absent"}` });
    setForms((current) =>
      current.map((form, index) =>
        form.status === null && (isManager || day.rows[index].record?.approvalStatus !== "Approved")
          ? {
              ...form,
              status,
              basicHours: status === "Present" ? String(settings.maxBasicHoursPerDay) : "0",
              overtimeHours: "0",
            }
          : form,
      ),
    );
    setSuccess(null);
    setError(null);
  }
  const markAllPresent = () => markRemaining("Present");
  function changeDate(value: string) {
    if (!value || value === date) return;
    if (value > today()) {
      setError("Future dates are not allowed.");
      return;
    }
    if (dirty) setNextDate(value);
    else setDate(value);
  }
  /** Fills workers with no status from the previous day's saved entries; anything already chosen is left alone. */
  async function copyFromYesterday() {
    if (!day || !settings || pending) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    setUndo(null);
    try {
      const previous = await getAttendance(shiftDate(date, -1));
      const byWorker = new Map(previous.rows.map((r) => [r.worker.id, r.record]));
      let copied = 0;
      // Worked out from the forms on screen now, so the count is known before the message is written.
      const next = forms.map((form, index) => {
        const record = byWorker.get(form.workerId);
        const open = isManager || day.rows[index].record?.approvalStatus !== "Approved";
        if (form.status !== null || !record?.status || !open || day.rows[index].approvedLeave) return form;
        copied += 1;
        const counted = record.status === "Present" || isLeaveStatus(record.status);
        return {
          ...form,
          status: record.status,
          basicHours: counted ? String(record.status === "Present" ? record.basicHours : settings.maxBasicHoursPerDay) : "0",
          overtimeHours: record.status === "Present" ? String(record.overtimeHours) : "0",
        };
      });
      setForms(next);
      setSuccess(
        copied > 0
          ? `Copied ${copied} ${copied === 1 ? "entry" : "entries"} from yesterday. Review them, then save.`
          : "Yesterday has nothing to copy for the workers still unrecorded.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!day || !settings || pending || !editable) return;
    const errors = forms.flatMap((form, index) => {
      if (!changed(form, day.rows[index])) return [];
      const message = validateHours(form, settings.maxBasicHoursPerDay);
      return message ? [`${day.rows[index].worker.fullName}: ${message}`] : [];
    });
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    setUndo(null);
    try {
      const saved = await saveAttendance(
        date,
        forms
          .filter((form, index) => changed(form, day.rows[index]))
          .map(formInput),
      );
      setDay(saved);
      setForms(saved.rows.map(formFromRow));
      setSuccess(
        isManager
          ? "Attendance saved."
          : "Attendance submitted for manager approval.",
      );
      announceAttendanceSummaryChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  /** Runs an approval action and shows the day the server returns. */
  async function decide(
    action: () => Promise<AttendanceDay>,
    message: string,
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await action();
      setDay(result);
      setForms(result.rows.map(formFromRow));
      setSuccess(message);
      announceAttendanceSummaryChanged();
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setPending(false);
    }
  }
  const approveAll = () =>
    decide(() => approveAttendance(date), "All waiting entries approved.");
  const approveOne = (row: AttendanceRow) =>
    decide(
      () => approveAttendance(date, [row.worker.id]),
      `${row.worker.fullName} approved.`,
    );
  const resubmit = (row: AttendanceRow) => {
    const index = day?.rows.findIndex((r) => r.worker.id === row.worker.id) ?? -1;
    if (index < 0) return Promise.resolve(false);
    return decide(
      () => saveAttendance(date, [formInput(forms[index])]),
      `${row.worker.fullName} resubmitted for approval.`,
    );
  };
  async function sendBack(reason: string) {
    if (!rejecting) return;
    const ok = await decide(
      () => rejectAttendance(date, [rejecting.worker.id], reason),
      `${rejecting.worker.fullName} sent back to the supervisor.`,
    );
    if (ok) setRejecting(null);
  }
  async function exportDay(format: "pdf" | "excel") {
    if (exporting || dirty) return;
    setExporting(format);
    setError(null);
    setSuccess(null);
    try {
      saveBlob(await getAttendanceExport(date, format), `Attendance_${date}.${format === "pdf" ? "pdf" : "xlsx"}`);
      setSuccess(`Attendance for ${date} downloaded as ${format === "pdf" ? "PDF" : "Excel"}.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setExporting(null);
    }
  }
  const exportButtonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60 max-sm:flex-1";
  const showSave = !loading && !loadError && editable;
  const renderSave = (className: string) => (
    <button
      type="button"
      onClick={save}
      disabled={!dirty || pending}
      aria-busy={pending}
      title={dirty ? undefined : "Change a status or hours to enable saving"}
      className={`${primaryButtonClass} ${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <Save aria-hidden="true" size={16} />
      {pending ? "Saving..." : "Save day"}
    </button>
  );
  const dateInput = (
    <input
      id="work-date"
      type="date"
      value={date}
      max={today()}
      disabled={pending}
      onChange={(e) => changeDate(e.target.value)}
      className={`min-h-11 rounded-lg border border-ink-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${isDesktop ? "" : "min-w-0 flex-1 text-center"}`}
    />
  );
  const attention = isManager
    ? { label: "Waiting for approval", days: summary?.submitted ?? [] }
    : { label: "Sent back for correction", days: summary?.rejected ?? [] };

  const dialogs = (
    <>
      <RejectDialog
        open={rejecting !== null}
        workerName={rejecting?.worker.fullName ?? ""}
        pending={pending}
        onCancel={() => setRejecting(null)}
        onConfirm={sendBack}
      />
      <ConfirmDialog
        open={nextDate !== null}
        title="Discard unsaved changes?"
        message="Your attendance edits have not been saved. Changing the date will discard them."
        confirmLabel="Discard changes"
        onCancel={() => setNextDate(null)}
        onConfirm={() => {
          if (nextDate) setDate(nextDate);
          setNextDate(null);
        }}
      />
    </>
  );

  if (!isDesktop) {
    const todayValue = today();
    const shiftLine = settings
      ? `Shift ${settings.shiftDescription}${showPay && settings.overtimeRatePerHour !== null ? ` · OT ${settings.overtimeRatePerHour.toFixed(2)} AED/hr` : ""}`
      : undefined;
    const counts = { total: forms.length, present, absent, leave: onLeave };
    const hasRows = !!day && day.rows.length > 0;
    // The day on screen is already shown by the banner below, so the list offers only the other days.
    const otherDays = attention.days.filter((item) => item.date !== date);
    // Supervisors get the plain people list; Managers and HR need pay and approval detail per worker, so they keep rows.
    const useList = !isManager && !showPay;

    return (
      <section className="min-w-0 space-y-4">
        {guardNavigation && <AttendanceNavigationGuard dirty={dirty} pending={pending} />}
        <PhoneHeader
          date={date}
          today={todayValue}
          subtitle={shiftLine}
          pending={pending}
          onPick={changeDate}
          menu={
            <RowMenu
              label="More actions"
              disabled={exporting !== null || pending}
              className="shrink-0"
              items={[
                ...(editable
                  ? [{ label: "Copy from yesterday", icon: Copy, onSelect: () => void copyFromYesterday() }]
                  : []),
                { label: "Print PDF", icon: FileText, disabled: dirty, disabledReason: "Save your changes first; the export contains saved attendance.", onSelect: () => void exportDay("pdf") },
                { label: "Excel", icon: FileSpreadsheet, disabled: dirty, disabledReason: "Save your changes first; the export contains saved attendance.", onSelect: () => void exportDay("excel") },
              ]}
            />
          }
        />

        {error && <ActionFailure message={error} />}
        {loading ? (
          <LoadingState label="Loading attendance..." rows={8} />
        ) : loadError ? (
          <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
        ) : (
          day &&
          settings && (
            <>
              {day.isFinalised && (
                <p role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  This month is finalised. Attendance is locked.
                </p>
              )}
              {(otherDays.length > 0 || (isManager && !day.isFinalised && day.pendingCount > 0)) && (
                <section aria-label="Needs attention" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  {isManager && !day.isFinalised && day.pendingCount > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 font-semibold">
                        {day.pendingCount} {day.pendingCount === 1 ? "entry is" : "entries are"} waiting for approval.
                        {dirty && <span className="mt-0.5 block font-normal">Save your changes before approving.</span>}
                      </p>
                      <button type="button" onClick={approveAll} disabled={pending || dirty} className={phoneButton("primary", "sm", "shrink-0")}>
                        <Check aria-hidden="true" size={16} strokeWidth={3} />
                        Approve all
                        <span className="sr-only"> ({day.pendingCount})</span>
                      </button>
                    </div>
                  )}
                  {otherDays.length > 0 && (
                    <div>
                      <p className="font-semibold">{isManager ? "Also waiting for approval" : attention.label}</p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {otherDays.map((item) => (
                          <li key={item.date}>
                            <button type="button" onClick={() => changeDate(item.date)} className={phoneButton("secondary", "sm", "text-amber-900")}>
                              {item.date} ({item.count})
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              {hasRows ? (
                <>
                  <PhoneSummary
                    {...counts}
                    pay={totalPay}
                    filter={filter}
                    onFilter={setFilter}
                    markable={canMarkAll ? markableCount : 0}
                    onMarkRest={markRemaining}
                  />
                  {useList ? (
                    <AttendanceList
                      rows={day.rows}
                      forms={forms}
                      editable={editable}
                      pending={pending}
                      maximum={settings.maxBasicHoursPerDay}
                      isManager={isManager}
                      canDecide={editable && !dirty}
                      filter={filter}
                      onChange={change}
                      onApprove={approveOne}
                      onReject={setRejecting}
                      onResubmit={resubmit}
                    />
                  ) : (
                    <AttendanceCards
                      rows={day.rows}
                      forms={forms}
                      editable={editable}
                      pending={pending}
                      maximum={settings.maxBasicHoursPerDay}
                      showPay={showPay}
                      companyRate={settings.overtimeRatePerHour}
                      isManager={isManager}
                      canDecide={editable && !dirty}
                      filter={filter}
                      onChange={change}
                      onApprove={approveOne}
                      onReject={setRejecting}
                      onResubmit={resubmit}
                    />
                  )}
                  {editable && (
                    <p className="px-1 text-center text-[0.8125rem] text-ink-600">
                      {showPay ? "Workers left unmarked are not paid for the day." : "Workers left unmarked get no hours for the day."}
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-ink-600">No workers for this date.</p>
              )}
            </>
          )
        )}
        <AttendanceRangeExport initialDate={todayValue} />
        {showSave && (
          <PhoneSaveBar
            unsaved={unsaved}
            pending={pending}
            undoLabel={undo?.label ?? null}
            onUndo={() => {
              if (undo) setForms(undo.forms);
              setUndo(null);
            }}
            onSave={save}
          />
        )}
        <PhoneToast message={success} lift={unsaved > 0 || undo !== null} onDone={() => setSuccess(null)} />
        {dialogs}
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-4">
      {guardNavigation && (
        <AttendanceNavigationGuard dirty={dirty} pending={pending} />
      )}
      <PageHeader title="Daily Attendance" description="Record daily status and hours, then save the day." />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className={isDesktop ? "" : "w-full"}>
          <label
            htmlFor="work-date"
            className="mb-1 block text-sm font-medium text-ink-800"
          >
            Work date
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              disabled={pending}
              onClick={() => changeDate(shiftDate(date, -1))}
              className={dayButtonClass}
            >
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            {dateInput}
            <button
              type="button"
              aria-label="Next day"
              disabled={pending || date >= today()}
              onClick={() => changeDate(shiftDate(date, 1))}
              className={dayButtonClass}
            >
              <ChevronRight aria-hidden="true" size={20} />
            </button>
            <button
              type="button"
              disabled={pending || date === today()}
              onClick={() => changeDate(today())}
              className={buttonClass("secondary", "md", "shrink-0")}
            >
              Today
            </button>
          </div>
        </div>
      </div>
      {attention.days.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{attention.label}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {attention.days.map((item) => (
              <li key={item.date}>
                <button
                  type="button"
                  onClick={() => changeDate(item.date)}
                  aria-current={item.date === date ? "date" : undefined}
                  className={buttonClass("secondary", "md", "text-amber-900")}
                >
                  {item.date} ({item.count})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {settings && (
        <p className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Standard Shift: {settings.shiftDescription} (
          {settings.maxBasicHoursPerDay} Basic Hours Max)
          {showPay && settings.overtimeRatePerHour !== null && (
            <> • Overtime Rate: {settings.overtimeRatePerHour.toFixed(2)} AED/hr</>
          )}
          <span className="mt-1 block">
            {showPay
              ? "Worker overtime overrides apply where set. Not recorded means no pay."
              : "Not recorded means no hours are counted."}
          </span>
        </p>
      )}
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}
      {loading ? (
        <LoadingState label="Loading attendance..." rows={8} />
      ) : loadError ? (
        <LoadError
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        day &&
        settings && (
          <>
            {day.isFinalised && (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              >
                This month is finalised. Attendance is locked.
              </p>
            )}
            {isManager && !day.isFinalised && day.pendingCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <span>
                  {day.pendingCount}{" "}
                  {day.pendingCount === 1 ? "entry is" : "entries are"} waiting
                  for approval on this date.
                  {dirty && " Save your changes before approving."}
                </span>
                <button
                  type="button"
                  onClick={approveAll}
                  disabled={pending || dirty}
                  className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <Check aria-hidden="true" size={16} />
                  Approve all ({day.pendingCount})
                </button>
              </div>
            )}
            {day.rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3 text-sm">
                {!isDesktop && (
                  <p className="font-medium text-ink-800">
                    {present} present · {absent} absent · {onLeave} on leave · {notRecorded} not recorded
                    {totalPay !== null && <span className="block font-semibold tabular-nums text-ink-900 sm:inline sm:before:content-['_·_']">{totalPay.toFixed(2)} AED</span>}
                  </p>
                )}
                {isDesktop && <p className="text-ink-600">Press P, A or L on a worker; the arrow keys move between workers.</p>}
                <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                  {canMarkAll && (
                    <button
                      type="button"
                      onClick={markAllPresent}
                      disabled={pending}
                      className={buttonClass("secondary", "md", "max-sm:flex-1 text-green-800")}
                    >
                      <CheckCheck aria-hidden="true" size={16} />
                      Mark all present
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => void copyFromYesterday()}
                      disabled={pending}
                      className={buttonClass("secondary", "md", "max-sm:flex-1")}
                    >
                      <Copy aria-hidden="true" size={16} />
                      Copy from yesterday
                    </button>
                  )}
                  <RowMenu
                    label="Export this day"
                    triggerText={exporting ? "Preparing..." : "Export"}
                    triggerIcon={Download}
                    disabled={exporting !== null}
                    items={[
                      { label: "Print PDF", icon: FileText, disabled: dirty, disabledReason: "Save your changes first; the export contains saved attendance.", onSelect: () => void exportDay("pdf") },
                      { label: "Excel", icon: FileSpreadsheet, disabled: dirty, disabledReason: "Save your changes first; the export contains saved attendance.", onSelect: () => void exportDay("excel") },
                    ]}
                  />
                </div>
              </div>
            )}
            {day.rows.length ? (
              <List
                rows={day.rows}
                forms={forms}
                editable={editable}
                pending={pending}
                maximum={settings.maxBasicHoursPerDay}
                showPay={showPay}
                companyRate={settings.overtimeRatePerHour}
                isManager={isManager}
                canDecide={editable && !dirty}
                onChange={change}
                onApprove={approveOne}
                onReject={setRejecting}
                onResubmit={resubmit}
              />
            ) : (
              <p className="rounded-card border border-line bg-white px-4 py-10 text-center text-ink-600">
                No workers for this date.
              </p>
            )}
          </>
        )
      )}
      <AttendanceRangeExport initialDate={today()} />
      {showSave && (
        <div
          className={
            isDesktop
              ? "sticky bottom-0 z-20 -mx-6 -mb-8 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-white/95 px-6 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur lg:-mx-8 lg:px-8"
              : "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex items-center gap-3 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] backdrop-blur"
          }
        >
          {isDesktop ? (
            <p className="min-w-0 text-sm font-medium text-ink-800">
              {present} present · {absent} absent · {onLeave} on leave · {notRecorded} not recorded
              {totalPay !== null && <span className="font-semibold tabular-nums text-ink-900"> · {totalPay.toFixed(2)} AED</span>}
              {dirty && (
                <span role="status" className="ml-3 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                  Unsaved changes
                </span>
              )}
            </p>
          ) : (
            <p role="status" className="min-w-0 flex-1 text-sm font-medium text-amber-900">
              {dirty ? `${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"}` : ""}
            </p>
          )}
          {renderSave(isDesktop ? "" : "min-h-12 px-6 text-base")}
        </div>
      )}
      {dialogs}
    </section>
  );
}
