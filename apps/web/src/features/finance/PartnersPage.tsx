import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Ban, Landmark, Paperclip, Pencil, Plus, UserPlus, UsersRound } from "lucide-react";
import {
  listFinAccounts, listFinCapital, listFinPartners, voidFinCapital,
  type FinAccount, type FinCapitalEntry, type FinCapitalKind, type FinCapitalList, type FinPartner, type FinPartners,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, Select, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { CapitalDialog } from "./CapitalDialog";
import { PartnerDialog } from "./PartnerDialog";
import { ReceiptDialog } from "./ReceiptDialog";
import { VoidDialog } from "./VoidDialog";
import { formatDay, formatMoney, formatPercent } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; partners: FinPartners; accounts: FinAccount[] };

/** One colour per partner on the ownership bar. The legend names every segment with its exact percentage, so colour is never the only cue. */
const SEGMENTS = ["bg-brand-300", "bg-amber-300", "bg-sky-300", "bg-rose-300", "bg-ink-300"];

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Total capital on a deep panel, with how it divides between the partners to two decimals. */
function CapitalPanel({ data }: { data: FinPartners }) {
  const holders = data.partners.filter((p) => p.netCapital > 0);
  return (
    <section aria-labelledby="total-capital" className="fade-up overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:p-7">
        <div>
          <p id="total-capital" className="flex items-center gap-2 text-sm font-medium text-white/75">
            <UsersRound aria-hidden="true" size={16} />
            Total capital
          </p>
          <p className="mt-2 font-display text-4xl font-bold tracking-tight tabular-nums md:text-5xl">
            <span className="mr-2 text-lg font-medium text-white/70">AED</span>
            {formatMoney(data.totalCapital)}
          </p>
          <p className="mt-3 text-sm text-white/70">
            Put in by {data.partners.length === 1 ? "1 partner" : `${data.partners.length} partners`}, less anything paid back. Capital is not income.
          </p>
        </div>
        <div className="self-end">
          {holders.length > 0 ? (
            <>
              <p className="text-sm font-medium text-white/75">Who put it in</p>
              <div
                role="img"
                aria-label={`Share of the capital: ${holders.map((p) => `${p.name} ${formatPercent(p.share)}`).join(", ")}`}
                className="mt-3 flex h-3.5 gap-0.5 overflow-hidden rounded-full"
              >
                {holders.map((p, i) => (
                  <span key={p.id} style={{ width: `${Math.max(p.share, 1.5)}%` }} className={cx("block h-full", SEGMENTS[i % SEGMENTS.length])} />
                ))}
              </div>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {holders.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", SEGMENTS[i % SEGMENTS.length])} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="font-semibold tabular-nums">{formatPercent(p.share)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-white/70">No capital is recorded yet. Add each partner's opening capital, then record capital as it is put in.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function PartnerCard({ partner, canEdit, onEdit, onAdd }: { partner: FinPartner; canEdit: boolean; onEdit: () => void; onAdd: () => void }) {
  return (
    <article aria-label={partner.name} className={cx("flex flex-col rounded-card border border-line bg-white p-5 shadow-card", !partner.isActive && "bg-ink-50")}>
      <header className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 break-words text-base font-semibold leading-snug text-ink-900">{partner.name}</h3>
        {!partner.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
      </header>

      <p className="mt-4 font-display text-4xl font-bold tracking-tight tabular-nums text-brand-700">
        {formatPercent(partner.share)}
        <span className="ml-2 text-sm font-medium tracking-normal text-ink-600">of the capital</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${partner.share}%` }} />
      </div>

      <p className="mt-4 flex items-baseline gap-2 tabular-nums text-ink-900">
        <span className="text-sm font-medium text-ink-500">AED</span>
        <span className="text-2xl font-semibold tracking-tight">{formatMoney(partner.netCapital)}</span>
      </p>

      <dl className="mb-4 mt-4 grid gap-1.5 border-t border-line pt-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Opening capital</dt>
          <dd className="tabular-nums text-ink-900">AED {formatMoney(partner.openingCapital)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Added since opening</dt>
          <dd className="tabular-nums text-ink-900">+ AED {formatMoney(partner.added)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Paid back</dt>
          <dd className="tabular-nums text-ink-900">− AED {formatMoney(partner.returned)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Last movement</dt>
          <dd className="text-ink-900">{partner.lastMovementDate ? formatDay(partner.lastMovementDate) : "None yet"}</dd>
        </div>
      </dl>

      {canEdit && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
          {partner.isActive && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd} aria-label={`Add capital for ${partner.name}`}>
              Add capital
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={`Edit ${partner.name}`}>
            Edit
          </Button>
        </div>
      )}
    </article>
  );
}

function MovementRow({ entry, canEdit, onCorrect, onVoid, onReceipts }: { entry: FinCapitalEntry; canEdit: boolean; onCorrect: () => void; onVoid: () => void; onReceipts: () => void }) {
  const putIn = entry.kind === "Capital";
  const voided = entry.status === "Voided";
  const Icon = putIn ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <li className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-5 py-3.5 sm:flex sm:items-center", voided && "bg-ink-50")}>
      <div className="sm:w-28 sm:shrink-0">
        <p className="text-sm font-medium tabular-nums text-ink-900">{formatDay(entry.entryDate)}</p>
        <p className="font-mono text-xs text-ink-500">{entry.entryNo}</p>
      </div>
      <p className={cx("text-right text-base font-semibold tabular-nums sm:order-last sm:w-40", voided ? "text-ink-500 line-through" : "text-ink-900")}>
        <span className="sr-only">{putIn ? "Capital added " : "Capital returned "}</span>
        <span aria-hidden="true">{putIn ? "+" : "−"}</span> <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
        {formatMoney(entry.amount)}
      </p>
      <div className="col-span-2 min-w-0 sm:flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink-900">
          <Icon aria-hidden="true" size={14} className="shrink-0 text-ink-500" />
          {entry.party}
          <span className="font-normal text-ink-600">{putIn ? "added capital" : "took capital back"}</span>
          {voided && <StatusBadge tone="neutral" variant="soft">Voided</StatusBadge>}
        </p>
        <p className="text-sm text-ink-600">
          {[entry.accountName, entry.reference, entry.replacesEntryNo && `Corrects ${entry.replacesEntryNo}`, entry.replacedByEntryNo && `Replaced by ${entry.replacedByEntryNo}`].filter(Boolean).join(" · ")}
        </p>
        {voided && entry.voidReason && <p className="text-sm text-ink-600">Voided by {entry.voidedBy}: {entry.voidReason}</p>}
      </div>
      <div className="col-span-2 flex flex-wrap gap-1 sm:order-last sm:col-span-1">
        {entry.attachments.length > 0 && (
          <Button size="sm" variant="ghost" icon={Paperclip} onClick={onReceipts} aria-label={`View files for ${entry.entryNo}`}>
            {entry.attachments.length}
          </Button>
        )}
        {canEdit && !voided && (
          <>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={onCorrect} aria-label={`Correct ${entry.entryNo}`}>Correct</Button>
            <Button size="sm" variant="ghost" icon={Ban} onClick={onVoid} aria-label={`Void ${entry.entryNo}`}>Void</Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Each partner's capital with exact figures and percentages, and every movement behind them. */
export function PartnersPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const variant = desktop ? "center" : "sheet";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [movements, setMovements] = useState<FinCapitalList | null>(null);
  const [filterPartner, setFilterPartner] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  const [editing, setEditing] = useState<FinPartner | "new" | null>(null);
  const [capital, setCapital] = useState<{ kind: FinCapitalKind; entry?: FinCapitalEntry; partnerId?: number } | null>(null);
  const [voiding, setVoiding] = useState<FinCapitalEntry | null>(null);
  const [viewing, setViewing] = useState<FinCapitalEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [partners, accounts, list] = await Promise.all([
        listFinPartners(),
        canEdit ? listFinAccounts() : Promise.resolve([] as FinAccount[]),
        listFinCapital({ partnerId: filterPartner ? Number(filterPartner) : undefined, includeVoided: showVoided }),
      ]);
      setLoad({ status: "ready", partners, accounts });
      setMovements(list);
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, [canEdit, filterPartner, showVoided]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const activePartners = useMemo(() => ready?.partners.partners.filter((p) => p.isActive) ?? [], [ready]);
  const activeAccounts = useMemo(() => ready?.accounts.filter((a) => a.isActive) ?? [], [ready]);
  const canRecord = canEdit && activePartners.length > 0 && activeAccounts.length > 0;

  return (
    <section className="space-y-5">
      <PageHeader
        title="Partners"
        description="The capital each partner has put into the company, as exact amounts and percentages. Capital raises an account's balance but is never income or an expense."
        actions={
          canEdit && ready && (
            <>
              <Button variant="secondary" icon={UserPlus} onClick={() => setEditing("new")}>
                Add partner
              </Button>
              <Button variant="secondary" icon={ArrowUpFromLine} disabled={!canRecord} onClick={() => setCapital({ kind: "CapitalOut" })}>
                Return capital
              </Button>
              <Button icon={Plus} disabled={!canRecord} onClick={() => setCapital({ kind: "Capital" })}>
                Add capital
              </Button>
            </>
          )
        }
      />
      <SuccessRegion message={message} />
      {problem && <ActionFailure message={problem} />}

      {load.status === "loading" && <LoadingState label="Loading partners..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}

      {ready && ready.partners.partners.length === 0 && (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="No partners yet"
            description={canEdit ? "Add each partner with the capital they had put in before this app was used. Then record capital as it comes in." : "A Manager adds the partners. They will appear here."}
            action={canEdit ? <Button icon={UserPlus} onClick={() => setEditing("new")}>Add the first partner</Button> : undefined}
          />
        </Card>
      )}

      {ready && ready.partners.partners.length > 0 && (
        <>
          <CapitalPanel data={ready.partners} />
          <div style={{ "--i": 1 } as React.CSSProperties} className="fade-up grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ready.partners.partners.map((p) => (
              <PartnerCard key={p.id} partner={p} canEdit={canEdit} onEdit={() => setEditing(p)} onAdd={() => setCapital({ kind: "Capital", partnerId: p.id })} />
            ))}
          </div>

          <Card>
            <CardHeader title="Capital movements" description="Every amount put in or paid back, newest first. Voided entries stay on record." />
            <div className="flex flex-wrap items-end gap-4 px-5 pb-4">
              <div className="min-w-48">
                <Select label="Partner" value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}>
                  <option value="">All partners</option>
                  {ready.partners.partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink-900">
                <input type="checkbox" className="size-5" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                Show voided entries
              </label>
              {movements && movements.count > 0 && (
                <p className="ml-auto text-sm text-ink-600">
                  Net in this list: <span className="font-semibold tabular-nums text-ink-900">AED {formatMoney(movements.total)}</span>
                </p>
              )}
            </div>
            {movements && movements.items.length === 0 ? (
              <EmptyState icon={Landmark} title="No capital movements" description="Capital put in or paid back is listed here." />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {movements?.items.map((e) => (
                  <MovementRow key={e.id} entry={e} canEdit={canEdit} onCorrect={() => setCapital({ kind: e.kind, entry: e })} onVoid={() => setVoiding(e)} onReceipts={() => setViewing(e)} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {editing && (
        <PartnerDialog
          partner={editing === "new" ? null : editing}
          variant={variant}
          onClose={() => setEditing(null)}
          onSaved={(_saved, text) => {
            setEditing(null);
            setMessage(text);
            setProblem(null);
            void refresh();
          }}
        />
      )}
      {capital && (
        <CapitalDialog
          kind={capital.kind}
          entry={capital.entry}
          partners={capital.entry ? ready?.partners.partners ?? [] : activePartners}
          accounts={activeAccounts}
          defaultPartnerId={capital.partnerId}
          variant={variant}
          onClose={() => setCapital(null)}
          onSaved={(saved) => {
            setCapital(null);
            setMessage(`${saved.entryNo}: AED ${formatMoney(saved.amount)} ${saved.kind === "Capital" ? "added by" : "paid back to"} ${saved.party}.`);
            setProblem(null);
            void refresh();
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          title={`Void ${voiding.entryNo}?`}
          message={`AED ${formatMoney(voiding.amount)} ${voiding.kind === "Capital" ? "added by" : "paid back to"} ${voiding.party} will no longer count in the account balance or the partner's capital. The entry stays on record, with who voided it and why.`}
          confirmLabel="Void"
          variant={variant}
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            await voidFinCapital(voiding.id, reason);
            setMessage(`${voiding.entryNo} was voided.`);
            setVoiding(null);
            await refresh();
          }}
        />
      )}
      {viewing && <ReceiptDialog title={`Files · ${viewing.entryNo}`} files={viewing.attachments} variant={variant} onClose={() => setViewing(null)} />}
    </section>
  );
}
