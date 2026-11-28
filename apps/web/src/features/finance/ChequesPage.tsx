import { useCallback, useEffect, useState } from "react";
import { FileCheck2, Pencil, Plus } from "lucide-react";
import {
  listFinAccounts, listFinCheques,
  type FinAccount, type FinCheque, type FinChequeDirection, type FinChequeList, type FinChequeStatus,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { useUrlSearch } from "../../utils/useUrlSearch";
import { Arrive, Button, Card, EmptyState, LoadingState, Mark, PageHeader, Select, StatusBadge, cx, notify, type StatusTone } from "../../ui";
import { TextField } from "../../components/TextField";
import { ActionFailure, LoadError } from "../workers/WorkersFeedback";
import { ChequeDialog } from "./ChequeDialog";
import { ChequeStatusDialog, STATUS_ACTIONS } from "./ChequeStatusDialog";
import { formatDay, formatMoney } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; list: FinChequeList; accounts: FinAccount[] };

const TONES: Record<FinChequeStatus, StatusTone> = {
  Issued: "warning", Delivered: "warning", Received: "info", Deposited: "info", Cleared: "success", Bounced: "danger", Cancelled: "neutral",
};

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function Figure({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "alert" }) {
  return (
    <div className="min-w-0 flex-1 basis-44 px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cx("mt-1 font-display text-2xl font-bold tabular-nums", tone === "alert" && value > 0 ? "text-danger" : "text-ink-900", value === 0 && "text-ink-400")}>
        <Mark value={value}>
          <span className="mr-1 text-sm font-medium text-ink-500">AED</span>
          {formatMoney(value)}
        </Mark>
      </p>
      <p className="mt-0.5 text-[13px] text-ink-500">{note}</p>
    </div>
  );
}

function ChequeRow({ order, cheque, canEdit, onEdit, onStatus }: { order: number; cheque: FinCheque; canEdit: boolean; onEdit: () => void; onStatus: (status: FinChequeStatus) => void }) {
  const issued = cheque.direction === "Issued";
  return (
    <Arrive as="li" order={order} className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 sm:flex sm:flex-wrap sm:items-center">
      <div className="min-w-0 sm:flex-1 sm:basis-56">
        <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold text-ink-900">
          <span className="break-words">{cheque.partyName}</span>
          <span className="text-[13px] font-normal text-ink-600">{issued ? "written to" : "received from"}</span>
        </p>
        <p className="text-[13px] text-ink-500">
          <span className="font-mono">#{cheque.serial}</span> · {cheque.accountName}
          {cheque.entryNo && <> · <span className="font-mono">{cheque.entryNo}</span></>}
        </p>
        {cheque.statusNote && <p className="text-[13px] text-ink-600">{cheque.statusNote}</p>}
      </div>
      <p className="text-right sm:order-last sm:w-44">
        <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
        <span className={cx("font-display text-xl font-bold tabular-nums", cheque.status === "Cancelled" ? "text-ink-500 line-through" : "text-ink-900")}>{formatMoney(cheque.amount)}</span>
      </p>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:w-64">
        <StatusBadge tone={TONES[cheque.status]} variant="soft">{cheque.status}</StatusBadge>
        <span className={cx("text-[13px] tabular-nums", cheque.isOverdue ? "font-semibold text-danger" : "text-ink-700")}>
          {cheque.isOverdue ? "Overdue since " : "Due "}
          {formatDay(cheque.dueDate)}
        </span>
        {cheque.isPostDated && cheque.isOpen && !cheque.isOverdue && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Post-dated</span>}
      </div>
      {canEdit && cheque.isOpen && (
        <div className="col-span-2 -ml-3 flex flex-wrap gap-1 sm:order-last sm:col-span-1">
          {cheque.nextStatuses.map((status) => (
            <Button key={status} size="sm" variant="ghost" className={STATUS_ACTIONS[status].danger ? "text-red-700 hover:bg-red-50 hover:text-red-800" : "text-brand-700"} onClick={() => onStatus(status)} aria-label={`${STATUS_ACTIONS[status].label}: cheque ${cheque.serial}`}>
              {STATUS_ACTIONS[status].label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={Pencil} className="text-ink-600" onClick={onEdit} aria-label={`Edit cheque ${cheque.serial}`}>Edit</Button>
        </div>
      )}
    </Arrive>
  );
}

/** Cheques written and received. A cheque is a promise, not a payment: it changes no balance until you record the expense or income. Open ones show as money already committed. */
export function ChequesPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const variant = desktop ? "center" : "sheet";
  const [direction, setDirection] = useState<"" | FinChequeDirection>("");
  const [view, setView] = useState<"open" | "all">("open");
  const [search, setSearch] = useState("");
  useUrlSearch((q) => { setSearch(q); setView("all"); setDirection(""); });   // a cheque picked in the top bar, cleared or not
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editing, setEditing] = useState<FinCheque | "new" | null>(null);
  const [moving, setMoving] = useState<{ cheque: FinCheque; status: FinChequeStatus } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, accounts] = await Promise.all([
        listFinCheques({ direction: direction || undefined, openOnly: view === "open", q: search.trim() || undefined }),
        canEdit ? listFinAccounts() : Promise.resolve([] as FinAccount[]),
      ]);
      setLoad({ status: "ready", list, accounts });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, [canEdit, direction, view, search]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refresh, search]);

  const ready = load.status === "ready" ? load : null;
  const hasBank = (ready?.accounts ?? []).some((a) => a.kind === "Bank" && a.isActive);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Cheques"
        description="Cheques you have written or been given. A cheque changes no balance by itself; open ones show as money already committed or expected, so a post-dated cheque is never forgotten."
        actions={canEdit && ready && <Button icon={Plus} disabled={!hasBank} onClick={() => setEditing("new")}>Add cheque</Button>}
      />
      {problem && <ActionFailure message={problem} />}
      {load.status === "loading" && <LoadingState label="Loading cheques..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}

      {ready && (
        <>
          <Arrive>
            <Card>
              <div className="flex flex-wrap divide-y divide-line sm:divide-x sm:divide-y-0">
                <Figure label="Committed" value={ready.list.openIssued} note="Cheques you wrote that have not cleared" />
                <Figure label="Expected" value={ready.list.openReceived} note="Cheques you were given that have not cleared" />
              </div>
            </Card>
          </Arrive>

          <Card>
            <div className="flex flex-wrap items-end gap-4 px-5 py-4">
              <div className="min-w-44">
                <Select label="Type" value={direction} onChange={(e) => setDirection(e.target.value as "" | FinChequeDirection)}>
                  <option value="">Written and received</option>
                  <option value="Issued">Written by us</option>
                  <option value="Received">Received</option>
                </Select>
              </div>
              <div className="min-w-44">
                <Select label="Show" value={view} onChange={(e) => setView(e.target.value as "open" | "all")}>
                  <option value="open">Not cleared yet</option>
                  <option value="all">Everything</option>
                </Select>
              </div>
              <div className="min-w-56 flex-1">
                <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number or name" autoComplete="off" />
              </div>
            </div>
            {ready.list.items.length === 0 ? (
              <EmptyState
                icon={FileCheck2}
                title={view === "open" ? "No open cheques" : "No cheques yet"}
                description={canEdit ? (hasBank ? "Add a cheque when you write or receive one. Its status moves from written to handed over to cleared." : "Add a bank account first. Cheques belong to a bank account.") : "A Manager records the cheques. They will appear here."}
                action={canEdit && hasBank ? <Button icon={Plus} onClick={() => setEditing("new")}>Add a cheque</Button> : undefined}
              />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {ready.list.items.map((c, index) => (
                  <ChequeRow key={c.id} order={index} cheque={c} canEdit={canEdit} onEdit={() => setEditing(c)} onStatus={(status) => setMoving({ cheque: c, status })} />
                ))}
              </ul>
            )}
            {ready.list.truncated && <p className="border-t border-line px-5 py-3 text-sm text-ink-600">Only the first 500 are shown. Narrow the list to see the rest.</p>}
          </Card>
        </>
      )}

      {ready && editing && (
        <ChequeDialog
          cheque={editing === "new" ? null : editing}
          direction={direction || "Issued"}
          accounts={ready.accounts}
          variant={variant}
          onClose={() => setEditing(null)}
          onSaved={(_, text) => {
            setEditing(null);
            setProblem(null);
            notify.success(text);
            void refresh();
          }}
        />
      )}
      {moving && (
        <ChequeStatusDialog
          cheque={moving.cheque}
          status={moving.status}
          variant={variant}
          onClose={() => setMoving(null)}
          onDone={(_, text) => {
            setMoving(null);
            setProblem(null);
            notify.success(text);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
