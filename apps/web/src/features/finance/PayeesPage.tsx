import { useCallback, useEffect, useState } from "react";
import { Contact, Pencil, Plus } from "lucide-react";
import { listFinCategories, listFinClients, listFinPayees, type FinCategory, type FinClient, type FinEntryKind, type FinPayee } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { PayeeDialog } from "./PayeeDialog";
import { ClientsDialog } from "../invoices/ClientsDialog";
import { formatMoney, quietZero } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; payees: FinPayee[]; clients: FinClient[]; categories: FinCategory[] };

/** One line of either tab: a payee the company pays, or a client who pays it. */
interface Row {
  key: number;
  name: string;
  isActive: boolean;
  detail: string;
  total: number;
  entryCount: number;
  payee?: FinPayee;
}

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Who the business pays (its payees) and who pays it (the client list the invoices use), with how much has gone through each. */
export function PayeesPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [kind, setKind] = useState<FinEntryKind>("Expense");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editing, setEditing] = useState<FinPayee | "new" | null>(null);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [payees, clients, categories] = await Promise.all([listFinPayees("Expense", true), listFinClients(), listFinCategories(true)]);
      setLoad({ status: "ready", payees, clients, categories });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const paying = kind === "Income";
  const shown: Row[] = !ready ? [] : paying
    ? ready.clients.map((c) => ({ key: c.id, name: c.name, isActive: c.isActive, detail: c.trn ? `TRN ${c.trn}` : "No TRN", total: c.total, entryCount: c.entryCount }))
    : ready.payees.map((p) => ({ key: p.id, name: p.name, isActive: p.isActive, detail: [p.defaultCategoryName, p.phone, p.taxNumber && `Tax no. ${p.taxNumber}`].filter(Boolean).join(" · ") || "No usual category", total: p.total, entryCount: p.entryCount, payee: p }));
  const add = paying
    ? <Button icon={Contact} onClick={() => setClientsOpen(true)}>Manage clients</Button>
    : <Button icon={Plus} onClick={() => setEditing("new")}>Add payee</Button>;

  return (
    <section className="space-y-5">
      <PageHeader
        title="Payees"
        description="Who you pay, and who pays you. Payees are picked on expenses and bills. Your clients are the same list the tax invoices use, so each one is entered once."
        actions={canEdit && ready && add}
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
              title={paying ? "No clients yet" : "No payees yet"}
              description={!canEdit ? "A Manager adds them. They will appear here." : paying ? "Add the customers you invoice or receive money from." : "Add the landlord, the insurer, the agent and the others you pay regularly."}
              action={canEdit ? add : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                      <span className={cx("break-words", !p.isActive && "text-ink-500 line-through")}>{p.name}</span>
                      {!p.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
                    </p>
                    <p className="text-[13px] text-ink-500">{p.detail}</p>
                  </div>
                  <p className="text-right text-sm">
                    <span className={cx("font-display text-base font-bold tabular-nums text-ink-900", quietZero(p.total))}><span className="mr-1 text-xs font-medium text-ink-500">AED</span>{formatMoney(p.total)}</span>
                    <span className="block text-[13px] text-ink-500">{p.entryCount === 1 ? "1 entry" : `${p.entryCount} entries`}</span>
                  </p>
                  {canEdit && p.payee && (
                    <Button size="sm" variant="ghost" icon={Pencil} className="text-ink-600" onClick={() => setEditing(p.payee!)} aria-label={`Edit ${p.name}`}>Edit</Button>
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
      <ClientsDialog open={clientsOpen} onClose={() => setClientsOpen(false)} onChanged={() => void refresh()} canWrite={canEdit} />
    </section>
  );
}
