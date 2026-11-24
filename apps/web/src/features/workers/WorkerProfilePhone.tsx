import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Circle, Download, Eye, EyeOff, Pencil, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { listLeave, type LeaveRequest } from "../../api/leave";
import type { Worker } from "../../api/workers";
import { PAGE_GAP, phoneButton } from "../../components/phoneUi";
import { RowMenu, LoadingState } from "../../ui";
import { LoadError } from "./WorkersFeedback";
import { formatRange, StatusPill } from "../leave/LeavePhone";
import { onboardingProgress } from "./WorkersTable";
import { WorkerStatusBadge } from "./WorkerStatusBadge";

export type ProfileTab = "overview" | "pay" | "onboarding" | "leave";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

/** One labelled value in a group: the label at the left, the value at the right, so a group reads down like a settings list. */
function Row({ label, children, center = false }: { label: string; children?: ReactNode; center?: boolean }) {
  return (
    <div className={`flex ${center ? "items-center" : "items-start"} justify-between gap-4 py-3.5`}>
      <dt className="shrink-0 text-sm text-ink-600">{label}</dt>
      <dd className="min-w-0 break-words text-right text-base font-medium text-ink-900">
        {children || <span className="text-sm font-normal text-ink-500">Not recorded</span>}
      </dd>
    </div>
  );
}

/** A titled group of rows in one card. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="px-1 text-sm font-bold text-ink-700">{title}</h3>
      <dl className="divide-y divide-ink-100 rounded-3xl border border-line bg-white px-4 shadow-card">{children}</dl>
    </section>
  );
}

/**
 * A document or account number, hidden until asked for: only the last four characters show. A glance over a supervisor's
 * shoulder on site should not read an Emirates ID, a passport or a bank account.
 */
function Secret({ label, value }: { label: string; value: string | null | undefined }) {
  const [shown, setShown] = useState(false);
  if (!value) return <Row label={label} />;
  const masked = `•••• ${value.slice(-4)}`;
  return (
    <Row label={label} center>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-[0.9375rem]">{shown ? value : masked}</span>
        <button
          type="button"
          aria-label={`${shown ? "Hide" : "Show"} ${label}`}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className={`-my-3 -mr-2 grid size-11 place-items-center rounded-xl text-brand-700 active:bg-brand-50 ${focusRing}`}
        >
          {shown ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      </span>
    </Row>
  );
}

function PhoneLeave({ workerId }: { workerId: number }) {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    listLeave({ workerId })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Unable to load leave."));
  }, [workerId]);
  useEffect(load, [load]);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!rows) return <LoadingState label="Loading leave..." rows={3} />;
  if (rows.length === 0) {
    return <p className="rounded-3xl border border-line bg-white px-5 py-10 text-center text-ink-600 shadow-card">No leave recorded for this worker.</p>;
  }
  const approved = rows.filter((r) => r.status === "Approved").reduce((sum, r) => sum + r.days, 0);
  const sorted = [...rows].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <section aria-label="Leave" className="space-y-2">
      <p className="px-1 text-sm font-bold text-ink-700">
        {rows.length} request{rows.length === 1 ? "" : "s"} · {approved} approved day{approved === 1 ? "" : "s"}
      </p>
      <ul className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
        {sorted.map((r) => (
          <li key={r.id} aria-label={`${r.leaveType}, ${r.status}`} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-base font-semibold text-ink-900">{r.leaveType}</p>
              <StatusPill status={r.status} />
            </div>
            <p className="mt-1 text-[0.9375rem] text-ink-700">
              <span className="tabular-nums">{formatRange(r.startDate, r.endDate)}</span> · {r.days} {r.days === 1 ? "day" : "days"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CHECKLIST: { key: keyof Worker; label: string }[] = [
  { key: "contractSigned", label: "Contract signed" },
  { key: "visaMedicalCleared", label: "Visa and medical cleared" },
  { key: "safetyGearIssued", label: "Safety gear issued" },
  { key: "siteOrientationDone", label: "Site orientation done" },
  { key: "wpsRegistered", label: "WPS registered" },
  { key: "badgeIssued", label: "Badge issued" },
];

interface Props {
  worker: Worker;
  photo: ReactNode;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  showPay: boolean;
  /** Managers and the Administrator also see the salary and rates. */
  showRates: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDownload: () => void;
  tenure: string | null;
  money: (value: number | null | undefined) => string | null;
  formatDate: (iso: string | null | undefined) => string;
}

/**
 * One worker on a phone. The top is who they are and the two things you do about it, call or edit; below, one tab at a time,
 * each a short list of rows. The work and contact details come first, and documents and account numbers are hidden until asked for.
 */
export function WorkerProfilePhone({ worker, photo, tab, onTab, showPay, showRates, canEdit, onEdit, onDownload, tenure, money, formatDate }: Props) {
  const progress = onboardingProgress(worker);
  const place = [worker.department, worker.workLocation].filter(Boolean).join(" · ");
  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    ...(showPay ? [{ key: "pay" as const, label: "Pay & bank" }] : []),
    { key: "onboarding", label: "Onboarding" },
    { key: "leave", label: "Leave" },
  ];
  const callHref = worker.phone ? `tel:${worker.phone.replace(/[^+\d]/g, "")}` : null;

  return (
    <div className={PAGE_GAP}>
      <Link to="/workers" className={phoneButton("quiet", "sm", "-ml-3 gap-1.5")}>
        <ArrowLeft aria-hidden="true" size={18} />
        All workers
      </Link>

      <section aria-label="Worker" className="rounded-3xl border border-line bg-white p-4 shadow-card">
        <div className="flex items-center gap-4">
          <div className="shrink-0">{photo}</div>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-bold leading-tight tracking-tight text-ink-900">{worker.fullName}</h2>
            <p className="mt-1 text-sm text-ink-700">
              {worker.designation}
              <span className="text-ink-500"> · </span>
              <span className="font-mono">{worker.workerCode}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WorkerStatusBadge isActive={worker.isActive} />
              {worker.category === "Employee" && (
                <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">Office</span>
              )}
            </div>
          </div>
        </div>
        {place && <p className="mt-3 text-sm text-ink-600">{place}</p>}
        {(callHref || canEdit || showPay) && (
          <div className="mt-4 flex items-center gap-2">
            {callHref && (
              <a href={callHref} aria-label={`Call ${worker.fullName}`} className={phoneButton("primary", "md", "flex-1")}>
                <Phone aria-hidden="true" size={18} />
                Call
              </a>
            )}
            {canEdit && (
              <button type="button" aria-label="Edit worker" onClick={onEdit} className={phoneButton(callHref ? "secondary" : "primary", "md", "flex-1")}>
                <Pencil aria-hidden="true" size={18} />
                Edit
              </button>
            )}
            {showPay && (
              <RowMenu label="More actions" className="shrink-0" items={[{ label: "Download record", icon: Download, onSelect: onDownload }]} />
            )}
          </div>
        )}
      </section>

      <div role="tablist" aria-label="Worker record" className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-ink-100 p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => onTab(key)}
            className={`min-h-12 rounded-xl px-1 text-[0.8125rem] font-bold transition-colors duration-150 ${focusRing} ${
              tab === key ? "bg-white text-ink-900 shadow-card" : "text-ink-700 active:bg-white/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={PAGE_GAP}>
        {tab === "overview" && (
          <>
            <Group title="Work">
              <Row label="Designation">{worker.designation}</Row>
              <Row label="Department">{worker.department}</Row>
              <Row label="Work location">{worker.workLocation}</Row>
            </Group>
            <Group title="Contact">
              <Row label="Phone">
                {worker.phone && (
                  <a className="text-brand-700 underline-offset-2 hover:underline" href={`tel:${worker.phone.replace(/[^+\d]/g, "")}`}>
                    {worker.phone}
                  </a>
                )}
              </Row>
              <Row label="Email">{worker.email}</Row>
              <Row label="Emergency contact">{worker.emergencyContact}</Row>
            </Group>
            <Group title="Personal">
              <Row label="Nationality">{worker.nationality}</Row>
              <Row label="Joined">{worker.joinDate && `${formatDate(worker.joinDate)}${tenure ? ` (${tenure})` : ""}`}</Row>
              <Secret label="Emirates ID" value={worker.emiratesId} />
              <Secret label="Passport number" value={worker.passportNumber} />
            </Group>
            {worker.notes && (
              <section aria-label="Notes" className="space-y-2">
                <h3 className="px-1 text-sm font-bold text-ink-700">Notes</h3>
                <p className="whitespace-pre-wrap rounded-3xl border border-line bg-white px-4 py-4 text-base text-ink-800 shadow-card">{worker.notes}</p>
              </section>
            )}
          </>
        )}

        {tab === "pay" && showPay && (
          <>
            <Group title="Pay">
              {showRates && (
                <>
                  <Row label="Monthly salary">{money(worker.monthlySalary)}</Row>
                  <Row label="Hourly rate">{money(worker.hourlyRate)}</Row>
                  <Row label="Overtime rate">
                    {worker.overtimeRate != null
                      ? money(worker.overtimeRate)
                      : worker.effectiveOvertimeRate != null
                        ? `Company rate (${money(worker.effectiveOvertimeRate)})`
                        : null}
                  </Row>
                </>
              )}
              <Row label="Basic salary">{money(worker.basicSalary ?? worker.monthlySalary)}</Row>
              <Row label="Housing allowance">{money(worker.housingAllowance)}</Row>
              <Row label="Transport allowance">{money(worker.transportAllowance)}</Row>
              <Row label="Other allowance">{money(worker.otherAllowance)}</Row>
            </Group>
            <Group title="Bank">
              <Row label="Bank">{worker.bankName}</Row>
              <Secret label="Account number" value={worker.bankAccountNumber} />
              <Secret label="IBAN" value={worker.iban} />
              <Row label="Exchange name">{worker.exchangeName}</Row>
              <Secret label="Card number" value={worker.cardNumber} />
              <Secret label="Exchange account number" value={worker.exchangeAccountNumber} />
            </Group>
          </>
        )}

        {tab === "onboarding" && (
          <section aria-label="Onboarding checklist" className="space-y-3">
            <div className="rounded-3xl border border-line bg-white p-4 shadow-card">
              <p className="text-base font-bold text-ink-900">
                {progress.done} of {progress.total} complete
              </p>
              <div aria-hidden="true" className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
            <ul className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
              {CHECKLIST.map(({ key, label }) => {
                const done = !!worker[key];
                return (
                  <li key={key} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    {done ? (
                      <CheckCircle2 aria-hidden="true" size={22} className="shrink-0 text-brand-600" />
                    ) : (
                      <Circle aria-hidden="true" size={22} className="shrink-0 text-ink-400" />
                    )}
                    <span className={`min-w-0 flex-1 text-base ${done ? "text-ink-900" : "font-medium text-ink-900"}`}>{label}</span>
                    <span className={`text-sm font-semibold ${done ? "text-brand-700" : "text-ink-600"}`}>
                      {done ? "Done" : "To do"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tab === "leave" && <PhoneLeave workerId={worker.id} />}
      </div>
    </div>
  );
}
