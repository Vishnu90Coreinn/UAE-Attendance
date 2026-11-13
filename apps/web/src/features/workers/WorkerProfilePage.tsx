import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft, Banknote, CalendarDays, CheckCircle2, Circle, Download, HardHat, Pencil, User, UserRound,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { listLeave, type LeaveRequest } from "../../api/leave";
import { getWorkerPhoto, getWorkerProfilePdf, listWorkers, type Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { canViewAll, isManagement, isReadOnly } from "../../permissions";
import { LoadingState, Button, Card, StatusBadge, cx } from "../../ui";
import { formatDisplayDate } from "../../utils/date";
import { formatRate } from "../../utils/money";
import { saveBlob } from "../payroll/downloadPdf";
import { LoadError } from "./WorkersFeedback";
import { WorkerFormDialog } from "./WorkerFormDialog";
import { WorkerStatusBadge } from "./WorkerStatusBadge";
import { onboardingProgress } from "./WorkersTable";

type TabKey = "overview" | "pay" | "onboarding" | "leave";

const NOT_RECORDED = "Not recorded";

function Loading({ what }: { what: string }) {
  return (
    <LoadingState label={`Loading ${what}...`} rows={4} />
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink-900">{children || <span className="text-ink-500">{NOT_RECORDED}</span>}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold text-ink-900">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
    </Card>
  );
}

function tenure(joinDate: string | null | undefined): string | null {
  if (!joinDate) return null;
  const start = new Date(`${joinDate}T00:00:00Z`);
  const now = new Date();
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} month${rest === 1 ? "" : "s"}`;
  return rest === 0 ? `${years} year${years === 1 ? "" : "s"}` : `${years}y ${rest}m`;
}

function money(value: number | null | undefined): string | null {
  return value == null ? null : `AED ${formatRate(value)}`;
}

function Photo({ worker }: { worker: Worker }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!worker.hasPhoto) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    getWorkerPhoto(worker.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [worker.id, worker.hasPhoto]);
  return url ? (
    <img src={url} alt={worker.fullName} className="size-24 rounded-xl border-4 border-white object-cover shadow-card" />
  ) : (
    <span aria-hidden="true" className="inline-flex size-24 items-center justify-center rounded-xl border-4 border-white bg-brand-100 text-brand-700 shadow-card">
      <UserRound size={44} />
    </span>
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

const leaveTone = { Pending: "warning", Approved: "success", Rejected: "danger" } as const;

function LeaveTab({ workerId }: { workerId: number }) {
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
  if (!rows) return <Loading what="leave" />;
  if (rows.length === 0) return <Card className="p-8 text-center text-sm text-ink-600">No leave recorded for this worker.</Card>;
  const approved = rows.filter((r) => r.status === "Approved").reduce((sum, r) => sum + r.days, 0);
  return (
    <Card>
      <p className="border-b border-line px-5 py-3 text-sm text-ink-600">
        {rows.length} request{rows.length === 1 ? "" : "s"} · {approved} approved day{approved === 1 ? "" : "s"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Leave requests</caption>
          <thead className="bg-ink-50/80 text-[0.6875rem] uppercase tracking-wider text-ink-500">
            <tr>
              {["Leave type", "Start", "End", "Days", "Status"].map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5">{r.leaveType}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatDisplayDate(r.startDate)}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatDisplayDate(r.endDate)}</td>
                <td className="px-4 py-2.5 tabular-nums">{r.days}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={leaveTone[r.status]} variant="soft">{r.status}</StatusBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** One worker's record on a page of its own: details, pay, onboarding and leave in tabs. */
export function WorkerProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const showPay = canViewAll(user?.role);
  const canEdit = showPay && !isReadOnly(user?.role);
  const workerId = Number(id);

  const [worker, setWorker] = useState<Worker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listWorkers(true)
      .then((all) => {
        const found = all.find((w) => w.id === workerId);
        if (found) setWorker(found);
        else setError("This worker could not be found.");
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Unable to load the worker."));
  }, [workerId]);
  useEffect(load, [load]);

  async function download(w: Worker) {
    setDownloadError(null);
    try {
      saveBlob(await getWorkerProfilePdf(w.id), `${w.workerCode}_${w.fullName.replace(/[^A-Za-z0-9-]+/g, "_")}_Information.pdf`);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : "The record could not be downloaded.");
    }
  }

  const back = (
    <Link to="/workers" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
      <ArrowLeft aria-hidden="true" size={15} />
      All workers
    </Link>
  );

  if (error) {
    return (
      <section>
        {back}
        <LoadError message={error} onRetry={load} />
      </section>
    );
  }
  if (!worker) {
    return (
      <section>
        {back}
        <Loading what="worker" />
      </section>
    );
  }

  const progress = onboardingProgress(worker);
  const tabs: { key: TabKey; label: string; icon: typeof User; show: boolean }[] = [
    { key: "overview", label: "Overview", icon: User, show: true },
    { key: "pay", label: "Pay & bank", icon: Banknote, show: showPay },
    { key: "onboarding", label: "Onboarding", icon: HardHat, show: true },
    { key: "leave", label: "Leave", icon: CalendarDays, show: true },
  ];
  const place = [worker.department, worker.workLocation].filter(Boolean).join(" · ");
  const served = tenure(worker.joinDate);

  return (
    <section>
      {back}
      <Card className="mb-4 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-brand-700 to-brand-500" aria-hidden="true" />
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-5 pb-4">
          <div className="-mt-10">
            <Photo worker={worker} />
          </div>
          <div className="min-w-0 flex-1 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">{worker.fullName}</h2>
              <WorkerStatusBadge isActive={worker.isActive} />
            </div>
            <p className="mt-0.5 text-sm text-ink-600">
              <span className="font-mono">{worker.workerCode}</span> · {worker.designation}
              {place && ` · ${place}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showPay && (
              <Button variant="secondary" icon={Download} onClick={() => void download(worker)}>
                Download record
              </Button>
            )}
            {canEdit && (
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                Edit worker
              </Button>
            )}
          </div>
        </div>
        <div role="tablist" aria-label="Worker record" className="flex gap-1 overflow-x-auto border-t border-line px-3">
          {tabs
            .filter((t) => t.show)
            .map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => setTab(key)}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                  tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-600 hover:text-ink-900",
                )}
              >
                <Icon aria-hidden="true" size={16} />
                {label}
              </button>
            ))}
        </div>
      </Card>

      {downloadError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {downloadError}
        </p>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Personal">
              <Fact label="Nationality">{worker.nationality}</Fact>
              <Fact label="Emirates ID">{worker.emiratesId && <span className="font-mono">{worker.emiratesId}</span>}</Fact>
              <Fact label="Passport number">{worker.passportNumber && <span className="font-mono">{worker.passportNumber}</span>}</Fact>
              <Fact label="Joined">{worker.joinDate && `${formatDisplayDate(worker.joinDate)}${served ? ` (${served})` : ""}`}</Fact>
            </Section>
            <Section title="Contact">
              <Fact label="Phone">
                {worker.phone && (
                  <a className="text-brand-700 hover:underline" href={`tel:${worker.phone.replace(/[^+\d]/g, "")}`}>
                    {worker.phone}
                  </a>
                )}
              </Fact>
              <Fact label="Email">{worker.email}</Fact>
              <Fact label="Emergency contact">{worker.emergencyContact}</Fact>
            </Section>
            <Section title="Work">
              <Fact label="Designation">{worker.designation}</Fact>
              <Fact label="Department">{worker.department}</Fact>
              <Fact label="Work location">{worker.workLocation}</Fact>
            </Section>
            {worker.notes && (
              <Card className="p-5">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">Notes</h3>
                <p className="whitespace-pre-wrap text-sm text-ink-700">{worker.notes}</p>
              </Card>
            )}
          </div>
        )}

        {tab === "pay" && showPay && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Pay">
              {isManagement(user?.role) ? (
                <>
                  <Fact label="Monthly salary">{money(worker.monthlySalary)}</Fact>
                  <Fact label="Hourly rate">{money(worker.hourlyRate)}</Fact>
                  <Fact label="Overtime rate">
                    {worker.overtimeRate != null
                      ? money(worker.overtimeRate)
                      : worker.effectiveOvertimeRate != null
                        ? `Company rate (${money(worker.effectiveOvertimeRate)})`
                        : null}
                  </Fact>
                </>
              ) : (
                <Fact label="Base salary">{money(worker.monthlySalary)}</Fact>
              )}
              <Fact label="Housing allowance">{money(worker.housingAllowance)}</Fact>
              <Fact label="Transport allowance">{money(worker.transportAllowance)}</Fact>
              <Fact label="Other allowance">{money(worker.otherAllowance)}</Fact>
            </Section>
            <Section title="Bank">
              <Fact label="Bank">{worker.bankName}</Fact>
              <Fact label="Account number">{worker.bankAccountNumber && <span className="font-mono">{worker.bankAccountNumber}</span>}</Fact>
              <Fact label="IBAN">{worker.iban && <span className="font-mono">{worker.iban}</span>}</Fact>
              <Fact label="Exchange name">{worker.exchangeName}</Fact>
              <Fact label="Card number">{worker.cardNumber && <span className="font-mono">{worker.cardNumber}</span>}</Fact>
              <Fact label="Exchange account number">{worker.exchangeAccountNumber && <span className="font-mono">{worker.exchangeAccountNumber}</span>}</Fact>
            </Section>
          </div>
        )}

        {tab === "onboarding" && (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-ink-900">Onboarding checklist</h3>
              <p className="text-sm text-ink-600">
                {progress.done} of {progress.total} complete
              </p>
            </div>
            <div aria-hidden="true" className="mb-4 h-2 overflow-hidden rounded-full bg-ink-200">
              <div
                className={cx("h-full", progress.done === progress.total ? "bg-success" : "bg-brand-600")}
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {CHECKLIST.map(({ key, label }) => {
                const done = !!worker[key];
                return (
                  <li key={key} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm">
                    {done ? (
                      <CheckCircle2 aria-hidden="true" size={18} className="text-success" />
                    ) : (
                      <Circle aria-hidden="true" size={18} className="text-ink-300" />
                    )}
                    <span className={done ? "text-ink-900" : "text-ink-600"}>{label}</span>
                    <span className="sr-only">{done ? ": done" : ": not done"}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {tab === "leave" && <LeaveTab workerId={worker.id} />}
      </div>

      {canEdit && (
        <WorkerFormDialog
          open={editing}
          worker={worker}
          hidePay={!isManagement(user?.role)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </section>
  );
}
