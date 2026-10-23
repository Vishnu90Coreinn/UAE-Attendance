import { useEffect, useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import {
  createDeductionType,
  getDeductions,
  listDeductionTypes,
  saveDeductions,
  updateDeductionType,
  type DeductionType,
  type MonthDeductions,
} from "../../api/deductions";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { canViewAll } from "../../permissions";
import {
  ActionFailure,
  LoadError,
  primaryButtonClass,
  SuccessRegion,
} from "../workers/WorkersFeedback";

interface Draft {
  amount: string;
  note: string;
}
type DraftRows = Record<number, Record<number, Draft>>;

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fieldErrors) return Object.values(error.fieldErrors).flat().join(" ");
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
function draftFrom(data: MonthDeductions): DraftRows {
  const rows: DraftRows = {};
  for (const worker of data.workers) {
    rows[worker.workerId] = {};
    for (const entry of worker.entries) {
      rows[worker.workerId][entry.deductionTypeId] = {
        amount: String(entry.amount),
        note: entry.note,
      };
    }
  }
  return rows;
}

/** Checks the draft before sending; returns the first problem, or null. */
function firstProblem(data: MonthDeductions, draft: DraftRows, types: DeductionType[]): string | null {
  for (const worker of data.workers) {
    for (const type of types) {
      const entry = draft[worker.workerId]?.[type.id];
      if (!entry || entry.amount.trim() === "") continue;
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
        return `${worker.fullName}, ${type.name}: enter an amount above 0 with at most 2 decimal places.`;
      }
      if (entry.note.trim() === "") {
        return `${worker.fullName}, ${type.name}: enter the reason for this deduction.`;
      }
    }
  }
  return null;
}

export function DeductionsPage() {
  const { user } = useAuth();
  /** HR, Managers and Administrators can add and change deductions; no other role reaches this screen. */
  const readOnly = !canViewAll(user?.role);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<MonthDeductions | null>(null);
  const [types, setTypes] = useState<DeductionType[]>([]);
  const [draft, setDraft] = useState<DraftRows>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newType, setNewType] = useState("");

  const activeTypes = useMemo(() => types.filter((t) => t.isActive), [types]);
  const dirty = useMemo(() => {
    if (!data) return false;
    return JSON.stringify(draft) !== JSON.stringify(draftFrom(data));
  }, [draft, data]);
  const finalised = !!data?.isFinalised;
  const locked = finalised || readOnly;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    Promise.all([getDeductions(month), listDeductionTypes()])
      .then(([result, typeList]) => {
        if (cancelled) return;
        setData(result);
        setDraft(draftFrom(result));
        setTypes(typeList);
        setLoading(false);
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
  }, [month, attempt]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function change(workerId: number, typeId: number, patch: Partial<Draft>) {
    setDraft((current) => {
      const worker = current[workerId] ?? {};
      const existing = worker[typeId] ?? { amount: "", note: "" };
      return { ...current, [workerId]: { ...worker, [typeId]: { ...existing, ...patch } } };
    });
    setSuccess(null);
    setError(null);
  }

  async function save() {
    if (!data || saving || locked) return;
    const problem = firstProblem(data, draft, activeTypes);
    if (problem) {
      setError(problem);
      return;
    }
    const workers = data.workers.map((worker) => ({
      workerId: worker.workerId,
      entries: activeTypes
        .filter((type) => (draft[worker.workerId]?.[type.id]?.amount ?? "").trim() !== "")
        .map((type) => ({
          deductionTypeId: type.id,
          amount: Number(draft[worker.workerId][type.id].amount),
          note: draft[worker.workerId][type.id].note.trim(),
        })),
    }));
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await saveDeductions(month, workers);
      setData(saved);
      setDraft(draftFrom(saved));
      setSuccess("Deductions saved.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addType() {
    const name = newType.trim();
    if (!name) return;
    try {
      const created = await createDeductionType(name);
      setTypes((current) => [...current, created]);
      setNewType("");
      setSuccess(`"${created.name}" added.`);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function toggleType(type: DeductionType) {
    try {
      const updated = await updateDeductionType(type.id, type.name, !type.isActive);
      setTypes((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setSuccess(`"${updated.name}" ${updated.isActive ? "is active again" : "is retired"}.`);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Deductions</h1>
        <p className="mt-1 text-sm text-gray-600">
          Advances, loans and other deductions for the month. Each deduction needs a reason. Finalised months are locked.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <label htmlFor="deduction-month" className="mb-1 block text-sm font-medium text-gray-800">
            Month
          </label>
          <input
            id="deduction-month"
            type="month"
            value={month}
            max={currentMonth()}
            disabled={dirty || saving}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />
          {dirty && <p className="mt-1 text-sm text-amber-900">Save or discard your changes before changing the month.</p>}
        </div>
        {!loading && !loadError && data && !locked && (
          <div className="flex flex-wrap gap-3">
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setDraft(draftFrom(data));
                  setError(null);
                }}
                disabled={saving}
                className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
              >
                Discard changes
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              aria-busy={saving}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Save aria-hidden="true" size={16} />
              {saving ? "Saving..." : "Save deductions"}
            </button>
          </div>
        )}
      </div>

      {finalised && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This month is finalised. Its deductions are locked and appear on the payslips.
        </p>
      )}
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}

      <section aria-labelledby="deduction-types-heading" className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 id="deduction-types-heading" className="text-base font-semibold text-gray-800">
          Deduction types
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {types.map((type) => (
            <li key={type.id}>
              <button
                type="button"
                onClick={() => toggleType(type)}
                disabled={readOnly}
                aria-pressed={type.isActive}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${type.isActive ? "border-slate-700 bg-slate-100 text-slate-900" : "border-gray-300 bg-white text-gray-500 line-through"}`}
              >
                {type.name}
                <span className="text-xs no-underline">{type.isActive ? "(in use)" : "(retired)"}</span>
              </button>
            </li>
          ))}
        </ul>
        {!readOnly && <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="new-deduction-type" className="mb-1 block text-sm font-medium text-gray-800">
              New deduction type
            </label>
            <input
              id="new-deduction-type"
              value={newType}
              maxLength={40}
              onChange={(e) => setNewType(e.target.value)}
              className="min-h-11 w-64 max-w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={addType}
            disabled={!newType.trim()}
            className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <Plus aria-hidden="true" size={16} />
            Add type
          </button>
        </div>}
      </section>

      {loading ? (
        <p role="status" className="py-8 text-gray-600">Loading deductions...</p>
      ) : loadError ? (
        <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : data && data.workers.length > 0 ? (
        <div className="overflow-x-auto md:rounded-lg md:border md:border-gray-200 md:bg-white md:shadow-sm">
          <table className="block w-full text-left text-sm text-gray-800 md:table md:min-w-[640px]">
            <caption className="sr-only">Deductions for {data.month} in AED</caption>
            <thead className="sr-only border-b border-gray-200 bg-gray-50 text-gray-700 md:not-sr-only md:table-header-group">
              <tr className="md:table-row">
                <th scope="col" className="px-4 py-3 font-semibold">Worker</th>
                {activeTypes.map((type) => (
                  <th key={type.id} scope="col" className="px-4 py-3 font-semibold">
                    {type.name} (AED) and reason
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-200">
              {data.workers.map((worker) => (
                <tr
                  key={worker.workerId}
                  className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none"
                >
                  <th scope="row" className="block px-0 pb-2 text-left font-medium md:table-cell md:px-4 md:py-3 md:align-top">
                    {worker.fullName}
                    <span className="block text-xs font-normal text-gray-600">{worker.workerCode}</span>
                    {!worker.isActive && <span className="block text-xs text-gray-600">Inactive</span>}
                  </th>
                  {activeTypes.map((type) => {
                    const entry = draft[worker.workerId]?.[type.id] ?? { amount: "", note: "" };
                    return (
                      <td key={type.id} className="block pb-2 md:table-cell md:px-4 md:py-3 md:pb-0 md:align-top">
                        <p className="mb-1 text-xs font-semibold uppercase text-gray-600 md:hidden">
                          {type.name} (AED) and reason
                        </p>
                        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                          <label className="sr-only" htmlFor={`amount-${worker.workerId}-${type.id}`}>
                            {type.name} amount for {worker.fullName}
                          </label>
                          <input
                            id={`amount-${worker.workerId}-${type.id}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={entry.amount}
                            disabled={locked || saving}
                            onChange={(e) => change(worker.workerId, type.id, { amount: e.target.value })}
                            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base tabular-nums disabled:bg-gray-100"
                          />
                          <label className="sr-only" htmlFor={`note-${worker.workerId}-${type.id}`}>
                            Reason for {type.name} for {worker.fullName}
                          </label>
                          <input
                            id={`note-${worker.workerId}-${type.id}`}
                            type="text"
                            maxLength={200}
                            value={entry.note}
                            placeholder="Reason"
                            disabled={locked || saving}
                            onChange={(e) => change(worker.workerId, type.id, { note: e.target.value })}
                            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base disabled:bg-gray-100"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-gray-600">
          No active workers for this month.
        </p>
      )}
    </section>
  );
}
