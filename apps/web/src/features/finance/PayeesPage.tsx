import { useCallback, useEffect, useState } from "react";
import { Contact, Pencil, Plus } from "lucide-react";
import { listFinCategories, listFinPayees, type FinCategory, type FinEntryKind, type FinPayee } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { PayeeDialog } from "./PayeeDialog";
import { formatMoney, quietZero } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; payees: FinPayee[]; categories: FinCategory[] };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** The people and companies the business pays or is paid by: saved once, picked on the entry forms, with how much has gone through each. */
export function PayeesPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [kind, setKind] = useState<FinEntryKind>("Expense");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editing, setEditing] = useState<FinPayee | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [payees, categories] = await Promise.all([listFinPayees(undefined, true), listFinCategories(true)]);
      setLoad({ status: "ready", payees, categories });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const shown = ready?.payees.filter((p) => p.kind === kind) ?? [];

  return (
    <section className="space-y-5">
      <PageHeader
        title="Payees"
        description="The people and companies you pay or receive money from. Pick one on an expense or income and its usual category is filled in, so reports can show what each one has cost or brought in."
        actions={canEdit && ready && <Button icon={Plus} onClick={() => setEditing("new")}>Add payee</Button>}
      />
      <SuccessRegion message={message} />
      {problem && <ActionFailure message={problem} />}
      {load.status === "loading" && <LoadingState label="Loading payees..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}

      {ready && (
        <Card>
          <div role="tablist" aria-label="Payee type" className="flex gap-1 border-b border-line px-3 pt-3">
            {(["Expense", "Income"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={cx("min-h-11 rounded-t-lg px-4 text-sm font-semibold", kind === k ? "border-b-2 border-brand-600 text-brand-700" : "text-ink-600 hover:bg-ink-50")}
              >
                {k === "Expense" ? "Paid to" : "Received from"}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={Contact}
              title={kind === "Expense" ? "No payees yet" : "No income sources yet"}
              description={canEdit ? "Add the landlord, the insurer, the agent and the others you pay regularly." : "A Manager adds them. They will appear here."}
              action={canEdit ? <Button icon={Plus} onClick={() => setEditing("new")}>Add payee</Button> : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                      <span className={cx("break-words", !p.isActive && "text-ink-500 line-through")}>{p.name}</span>
                      {!p.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
                    </p>
                    <p className="text-xs text-ink-500">{[p.defaultCategoryName, p.phone, p.taxNumber && `Tax no. ${p.taxNumber}`].filter(Boolean).join(" · ") || "No usual category"}</p>
                  </div>
                  <p className="text-right text-sm">
                    <span className={cx("font-display text-base font-bold tabular-nums text-ink-900", quietZero(p.total))}>AED {formatMoney(p.total)}</span>
                    <span className="block text-xs text-ink-500">{p.entryCount === 1 ? "1 entry" : `${p.entryCount} entries`}</span>
                  </p>
                  {canEdit && (
                    <Button size="sm" variant="ghost" icon={Pencil} className="text-ink-600" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>Edit</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {ready && editing && (
        <PayeeDialog
          payee={editing === "new" ? null : editing}
          kind={kind}
          categories={ready.categories}
          variant={desktop ? "center" : "sheet"}
          onClose={() => setEditing(null)}
          onSaved={(saved, text) => {
            setEditing(null);
            setProblem(null);
            setMessage(text);
            setKind(saved.kind);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
