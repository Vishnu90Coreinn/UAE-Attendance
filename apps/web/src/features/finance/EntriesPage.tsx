import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Download, FileUp, Lock, Paperclip, Pencil, Plus, ReceiptText, Search, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { approveFinExpense, listFinAccounts, listFinCategories, listFinEntries, listFinMonthLocks, rejectFinExpense, voidFinEntry, type FinAccount, type FinCategory, type FinEntry, type FinEntryFilter, type FinEntryKind, type FinEntryList } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { useUrlSearch } from "../../utils/useUrlSearch";
import { Button, Card, EmptyState, IconButton, LoadingState, PageHeader, Select, SortTh, StatusBadge, Table, TableScroll, THead, Th, TRow, Td, cx, useSort } from "../../ui";
import { TextField } from "../../components/TextField";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { EntryDialog } from "./EntryDialog";
import { ImportDialog } from "./ImportDialog";
import { ReceiptDialog } from "./ReceiptDialog";
import { VoidDialog } from "./VoidDialog";
import { saveBlob } from "../payroll/downloadPdf";
import { entriesCsv } from "./entriesCsv";
import { formatDay, formatMoney, parseMoneyInput, todayInUae } from "./financeFormat";

type Preset = "month" | "30" | "year" | "all";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "30", label: "Last 30 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: Preset): { from: string; to: string } {
  const today = todayInUae();
  if (preset === "month") return { from: today.slice(0, 8) + "01", to: today };
  if (preset === "30") return { from: addDays(today, -29), to: today };
  if (preset === "year") return { from: today.slice(0, 5) + "01-01", to: today };
  return { from: "", to: "" };
}

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function ReceiptButton({ entry, onOpen }: { entry: FinEntry; onOpen: () => void }) {
  const count = entry.attachments.length;
  const word = entry.kind === "Income" ? "attachment" : "receipt";
  if (count === 0) return <span className="text-sm text-ink-500">{entry.kind === "Income" ? "None" : "No receipt"}</span>;
  return (
    <button type="button" onClick={onOpen} aria-label={`View ${count === 1 ? word : `${count} ${word}s`} for ${entry.entryNo}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 md:min-h-9">
      <Paperclip aria-hidden="true" size={16} />
      {count === 1 ? (word === "receipt" ? "Receipt" : "Attachment") : `${count} ${word}s`}
    </button>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Why an entry in an old month cannot be changed, said once at the top: the newest locked month, and that the Manager can unlock it. */
function LockNote({ months }: { months: string[] }) {
  const newest = [...months].sort().at(-1)!;
  const [year, month] = newest.split("-").map(Number);
  return (
    <p className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
      <Lock aria-hidden="true" size={14} className="shrink-0 text-ink-500" />
      <span>Locked up to {MONTH_NAMES[month - 1]} {year}. Entries dated in a locked month cannot be added, corrected or voided until a Manager unlocks the month (Finance setup).</span>
    </p>
  );
}

/** Voided, corrected and locked-month notes under an entry's name. Words as well as colour. */
function EntryMeta({ entry, locked }: { entry: FinEntry; locked: boolean }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {entry.status === "Voided" && <StatusBadge tone="danger" variant="soft">{entry.voidReason?.startsWith("Rejected") ? "Rejected" : "Voided"}</StatusBadge>}
      {entry.status === "Pending" && <StatusBadge tone="warning" variant="soft">Waiting for approval</StatusBadge>}
      {entry.replacesEntryNo && <span className="text-[13px] text-ink-600">Corrects {entry.replacesEntryNo}</span>}
      {entry.replacedByEntryNo && <span className="text-[13px] text-ink-600">Replaced by {entry.replacedByEntryNo}</span>}
      {entry.invoiceId != null && <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800" title="Change or remove it on the tax invoice">Payment on a tax invoice</span>}
      {entry.billId != null && <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800" title="Take it back on the supplier bill">Payment on a supplier bill</span>}
      {locked && entry.status === "Active" && <span className="inline-flex items-center gap-1 text-[13px] text-ink-600"><Lock aria-hidden="true" size={12} /> Locked month</span>}
      {(entry.taxAmount ?? 0) > 0 && <span className="text-xs tabular-nums text-ink-500">VAT AED {formatMoney(entry.taxAmount ?? 0)}</span>}
      {entry.kind === "Expense" && <span className="text-[13px] text-ink-500">Entered by {entry.createdBy}</span>}
      {entry.status === "Voided" && entry.voidReason && <span className="w-full text-[13px] text-ink-600">{entry.voidedBy ? `${entry.voidedBy}: ` : ""}{entry.voidReason}</span>}
    </span>
  );
}

function EntryActions({ entry, onCorrect, onVoid }: { entry: FinEntry; onCorrect: () => void; onVoid: () => void }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" icon={Pencil} className="text-ink-600" onClick={onCorrect} aria-label={`Correct ${entry.entryNo}`}>Correct</Button>
      <Button size="sm" variant="ghost" icon={Ban} className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={onVoid} aria-label={`Void ${entry.entryNo}`}>Void</Button>
    </span>
  );
}

/** A staff member's expense waiting for a Manager: approve it into the books, or reject it with a reason. */
function ReviewActions({ entry, onApprove, onReject, busy }: { entry: FinEntry; onApprove: () => void; onReject: () => void; busy: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" icon={Check} className="text-brand-700" disabled={busy} onClick={onApprove} aria-label={`Approve ${entry.entryNo}`}>Approve</Button>
      <Button size="sm" variant="ghost" icon={Ban} className="text-red-700 hover:bg-red-50 hover:text-red-800" disabled={busy} onClick={onReject} aria-label={`Reject ${entry.entryNo}`}>Reject</Button>
    </span>
  );
}

/** The table's last column: the file (with how many), correct and void as icons, so nothing is pushed off the edge of the table. */
function RowTools({ entry, canAct, onOpen, onCorrect, onVoid }: { entry: FinEntry; canAct: boolean; onOpen: () => void; onCorrect: () => void; onVoid: () => void }) {
  const count = entry.attachments.length;
  const word = entry.kind === "Income" ? "attachment" : "receipt";
  return (
    <span className="flex items-center justify-end gap-0.5">
      {count > 0 ? (
        <button type="button" onClick={onOpen} aria-label={`View ${count === 1 ? word : `${count} ${word}s`} for ${entry.entryNo}`} title={`View ${word}${count === 1 ? "" : "s"}`}
          className="inline-flex size-9 items-center justify-center gap-0.5 rounded-lg text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
          <Paperclip aria-hidden="true" size={16} />
          {count > 1 && <span className="text-xs">{count}</span>}
        </button>
      ) : entry.kind === "Expense" ? (
        <span className="px-2 text-[13px] text-ink-500">No receipt</span>
      ) : null}
      {canAct && (
        <>
          <IconButton icon={Pencil} label={`Correct ${entry.entryNo}`} onClick={onCorrect} />
          <IconButton icon={Ban} label={`Void ${entry.entryNo}`} onClick={onVoid} />
        </>
      )}
    </span>
  );
}

function CategoryChip({ name }: { name: string }) {
  return <span className="inline-block max-w-full truncate rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">{name}</span>;
}

/** One chip for an ordinary entry; for a split entry, the categories with the part each one has. */
function Categories({ entry }: { entry: FinEntry }) {
  const lines = entry.lines ?? [];
  if (lines.length < 2) return <CategoryChip name={entry.categoryName} />;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">Split in {lines.length}</span>
      {lines.map((l, i) => (
        <span key={i} className="text-[13px] text-ink-600">
          {l.categoryName} <span className="tabular-nums text-ink-800">{formatMoney(l.amount)}</span>
          {l.note ? <span className="text-ink-500"> ({l.note})</span> : null}
        </span>
      ))}
    </span>
  );
}

function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("tabular-nums", className)}>
      <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
      {formatMoney(value)}
    </span>
  );
}

/** Every recorded expense or income, newest first, with search and filters and the total of whatever is shown. */
export function EntriesPage({ kind }: { kind: FinEntryKind }) {
  const income = kind === "Income";
  const noun = income ? "income" : "expense";
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [tools, setTools] = useState(false);
  // Arriving from an account card ("?account=3&period=all") opens that account's whole history.
  const [params] = useSearchParams();
  const [preset, setPreset] = useState<Preset>(() => (params.get("period") === "all" ? "all" : "month"));
  const [from, setFrom] = useState(() => presetRange(params.get("period") === "all" ? "all" : "month").from);
  const [to, setTo] = useState(() => presetRange(params.get("period") === "all" ? "all" : "month").to);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState(() => params.get("account") ?? "");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [lists, setLists] = useState<{ accounts: FinAccount[]; categories: FinCategory[] } | null>(null);
  const [result, setResult] = useState<FinEntryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<FinEntry | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [voiding, setVoiding] = useState<FinEntry | null>(null);
  const [rejecting, setRejecting] = useState<FinEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const [approving, setApproving] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<FinEntry | null>(null);
  const [lockedMonths, setLockedMonths] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // A record picked in the top bar: search for it across all dates and accounts.
  useUrlSearch((q) => {
    setSearch(q);
    setQuery(q);
    setPreset("all");
    const range = presetRange("all");
    setFrom(range.from);
    setTo(range.to);
    setCategoryId("");
    setAccountId("");
  });

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFinAccounts(), listFinCategories(true), listFinMonthLocks()])
      .then(([accounts, categories, locks]) => {
        if (cancelled) return;
        setLists({ accounts, categories: categories.filter((c) => c.kind === kind) });
        setLockedMonths(locks.filter((l) => l.isLocked).map((l) => l.month));
      })
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const minValue = min ? parseMoneyInput(min) : null;
  const maxValue = max ? parseMoneyInput(max) : null;
  const filter = useMemo<FinEntryFilter>(
    () => ({
      from: from || undefined, to: to || undefined, categoryId: categoryId ? Number(categoryId) : undefined, accountId: accountId ? Number(accountId) : undefined,
      min: minValue ?? undefined, max: maxValue ?? undefined, q: query.trim() || undefined, includeVoided: showVoided || undefined,
    }),
    [from, to, categoryId, accountId, minValue, maxValue, query, showVoided],
  );

  const load = useCallback(() => {
    let cancelled = false;
    listFinEntries(kind, filter)
      .then((list) => {
        if (cancelled) return;
        setResult(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [kind, filter]);

  useEffect(() => load(), [load]);

  async function approve(entry: FinEntry) {
    setApproving(entry.id);
    try {
      await approveFinExpense(entry.id);
      setMessage(`${entry.entryNo}: AED ${formatMoney(entry.amount)} to ${entry.party} was approved and now counts.`);
      load();
    } catch (e) {
      setError(failure(e));
    } finally {
      setApproving(null);
    }
  }

  function choose(next: Preset) {
    const range = presetRange(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  const { sorted, sort, toggle } = useSort(result?.items ?? [], {
    date: (e) => `${e.entryDate}${String(e.id).padStart(8, "0")}`,
    party: (e) => e.party.toLowerCase(),
    category: (e) => e.categoryName.toLowerCase(),
    account: (e) => e.accountName.toLowerCase(),
    amount: (e) => e.amount,
  });

  function downloadCsv() {
    if (!result) return;
    const stamp = `${from || "start"}_${to || "today"}`;
    saveBlob(new Blob([entriesCsv(result.items, kind)], { type: "text/csv;charset=utf-8" }), `${income ? "Income" : "Expenses"}_${stamp}.csv`);
  }

  const activeFilterCount = [categoryId, accountId, min, max].filter(Boolean).length;
  const filtered = Boolean(categoryId || accountId || min || max || query.trim());
  const periodLabel = preset === "all" && !from && !to ? "All time" : from && to ? `${formatDay(from)} to ${formatDay(to)}` : from ? `From ${formatDay(from)}` : to ? `Until ${formatDay(to)}` : "All time";
  const activeAccounts = lists?.accounts.filter((a) => a.isActive) ?? [];
  const activeCategories = lists?.categories.filter((c) => c.isActive) ?? [];
  const variant = desktop ? "center" : "sheet";

  const filters = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">All categories</option>
        {lists?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">All accounts</option>
        {lists?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
      <TextField label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("all"); }} />
      <TextField label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("all"); }} />
      <TextField label="Amount from (AED)" value={min} inputMode="decimal" onChange={(e) => setMin(e.target.value)} error={min && minValue === null ? "Enter a number." : undefined} />
      <TextField label="Amount to (AED)" value={max} inputMode="decimal" onChange={(e) => setMax(e.target.value)} error={max && maxValue === null ? "Enter a number." : undefined} />
    </div>
  );

  return (
    <section className="space-y-5">
      <PageHeader
        title={income ? "Income" : "Expenses"}
        description={income ? "Money the company has received: entered here, or recorded as a payment on a tax invoice (those rows say so and are changed on the invoice). Correct replaces an entry with a new one, Void cancels it; nothing is ever deleted." : "Money the company has paid out, each with its receipt. Correct replaces an entry with a new one, Void cancels it; nothing is ever deleted."}
        actions={
          <>
            {/* On a phone the file tools wait behind "More tools", so the list starts higher. */}
            {!desktop && <Button variant="secondary" aria-expanded={tools} onClick={() => setTools((t) => !t)}>More tools</Button>}
            {(desktop || tools) && result && result.items.length > 0 && <Button variant="secondary" icon={Download} onClick={downloadCsv}>Download CSV</Button>}
            {(desktop || tools) && canEdit && lists && <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>Import from Excel</Button>}
            {canEdit && lists && <Button icon={Plus} onClick={() => setAdding(true)}>{income ? "Add income" : "Add expense"}</Button>}
          </>
        }
      />
      {lockedMonths.length > 0 && <LockNote months={lockedMonths} />}
      <SuccessRegion message={message} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-brand-50/60 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink-600">{filtered ? `Total of the matching ${noun}${income ? "" : "s"}` : income ? "Total received" : "Total spent"} · {periodLabel}</p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink-900 md:text-4xl">
              {result ? <Amount value={result.total} /> : <span className="text-ink-400">...</span>}
            </p>
          </div>
          {result && (result.pendingCount ?? 0) > 0 && !income && (
            <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold tabular-nums">{result.pendingCount}</span> {result.pendingCount === 1 ? "expense is" : "expenses are"} waiting for approval (AED <span className="tabular-nums">{formatMoney(result.pendingTotal ?? 0)}</span>). {result.pendingCount === 1 ? "It is" : "They are"} not in the total until approved.
            </p>
          )}
          {result && <p className="text-sm text-ink-600"><span className="font-semibold tabular-nums text-ink-900">{result.count}</span> {income ? "entries" : result.count === 1 ? "expense" : "expenses"}</p>}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => choose(p.key)}
                className={cx("min-h-11 rounded-full border px-3.5 text-sm font-medium md:min-h-9", preset === p.key ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink-700 hover:border-brand-300")}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="relative min-w-0 flex-1">
              <TextField label="Search" hideLabel placeholder={income ? "Search received from, reference, notes or number" : "Search paid to, reference, notes or number"} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Search aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            </div>
            <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          </div>
          {showFilters && filters}
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm text-ink-700 md:min-h-9">
            <input type="checkbox" className="size-5" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            Show voided {income ? "income" : "expenses"}
          </label>
          {filtered && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setCategoryId(""); setAccountId(""); setMin(""); setMax(""); setSearch(""); }}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {error && result === null && <LoadError message={error} onRetry={() => { setError(null); load(); }} />}
      {error && result !== null && <ActionFailure message={error} />}
      {!error && result === null && <LoadingState label="Loading expenses..." />}

      {result && result.items.length === 0 && (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title={filtered || preset !== "all" ? (income ? "No income matches" : "No expenses match") : income ? "No income yet" : "No expenses yet"}
            description={filtered || preset !== "all" ? "Try another period or clear the filters." : canEdit ? (income ? "Record the first income received." : "Record the first expense with its receipt.") : `A Manager records ${noun}. It will appear here.`}
            action={canEdit && !filtered && preset === "all" && lists ? <Button icon={Plus} onClick={() => setAdding(true)}>{income ? "Add income" : "Add expense"}</Button> : undefined}
          />
        </Card>
      )}

      {result && result.items.length > 0 && (desktop ? (
        <Card>
          <TableScroll>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Date" sortKey="date" sort={sort} onToggle={toggle} className="px-4 py-3 text-left font-semibold" />
                  <SortTh label={income ? "Received from" : "Paid to"} sortKey="party" sort={sort} onToggle={toggle} className="px-4 py-3 text-left font-semibold" />
                  <SortTh label="Category" sortKey="category" sort={sort} onToggle={toggle} className="px-4 py-3 text-left font-semibold" />
                  <SortTh label="Account" sortKey="account" sort={sort} onToggle={toggle} className="px-4 py-3 text-left font-semibold" />
                  <SortTh label="Amount" sortKey="amount" sort={sort} onToggle={toggle} align="right" className="px-4 py-3 text-right font-semibold" />
                  <Th><span className="sr-only">{income ? "Attachment and actions" : "Receipt and actions"}</span></Th>
                </tr>
              </THead>
              <tbody>
                {sorted.map((e) => (
                  <TRow key={e.id} className={e.status === "Voided" ? "bg-ink-50 text-ink-500" : undefined}>
                    <Td className="whitespace-nowrap align-top"><span className="font-medium tabular-nums text-ink-900">{formatDay(e.entryDate)}</span><br /><span className="font-mono text-[13px] text-ink-500">{e.entryNo}</span></Td>
                    <Td className="max-w-md align-top">
                      <span className={cx("font-medium", e.status === "Voided" ? "text-ink-600 line-through" : "text-ink-900")}>{e.party}</span>
                      {(e.reference || e.notes) && (
                        <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-500">
                          {e.reference && <span className="mr-2 font-mono text-[13px] text-ink-500">Ref {e.reference}</span>}
                          {e.notes}
                        </span>
                      )}
                      <EntryMeta entry={e} locked={lockedMonths.includes(e.entryDate.slice(0, 7))} />
                    </Td>
                    <Td className="align-top"><Categories entry={e} /></Td>
                    <Td className="align-top text-ink-700">{e.accountName}</Td>
                    <Td className={cx("whitespace-nowrap text-right align-top font-display text-base font-bold", e.status === "Voided" ? "text-ink-500 line-through" : "text-ink-900")}><Amount value={e.amount} /></Td>
                    <Td className="align-top">
                      <RowTools entry={e} canAct={canEdit && e.status === "Active" && e.invoiceId == null && e.billId == null && !lockedMonths.includes(e.entryDate.slice(0, 7))} onOpen={() => setViewing(e)} onCorrect={() => setCorrecting(e)} onVoid={() => setVoiding(e)} />
                      {canEdit && e.status === "Pending" && <div className="mt-1 flex justify-end"><ReviewActions entry={e} busy={approving === e.id} onApprove={() => void approve(e)} onReject={() => setRejecting(e)} /></div>}
                    </Td>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ) : (
        <ul className="space-y-3">
          {result.items.map((e) => (
            <li key={e.id}>
              <article aria-label={`${e.party} ${e.entryNo}`} className={cx("rounded-card border border-line p-4 shadow-card", e.status === "Voided" ? "bg-ink-50" : "bg-white")}>
                {/* 1. who and how much lead; 2. when; 3. notes, account and reference are quiet; 4. actions are quietest */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cx("break-words text-[15px] font-semibold leading-snug", e.status === "Voided" ? "text-ink-500 line-through" : "text-ink-900")}>{e.party}</p>
                    <p className="mt-0.5 text-[13px] text-ink-500"><span className="tabular-nums">{formatDay(e.entryDate)}</span> · <span className="font-mono">{e.entryNo}</span></p>
                  </div>
                  <p className={cx("shrink-0 text-right", e.status === "Voided" && "line-through")}>
                    <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
                    <span className={cx("font-display text-xl font-bold tabular-nums", e.status === "Voided" ? "text-ink-500" : "text-ink-900")}>{formatMoney(e.amount)}</span>
                  </p>
                </div>
                {e.notes && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink-600">{e.notes}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-ink-600">
                  <Categories entry={e} />
                  <span>{e.accountName}</span>
                  {e.reference && <span className="font-mono text-ink-500">Ref {e.reference}</span>}
                </div>
                <div className="mt-1"><EntryMeta entry={e} locked={lockedMonths.includes(e.entryDate.slice(0, 7))} /></div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-1.5">
                  <ReceiptButton entry={e} onOpen={() => setViewing(e)} />
                  {canEdit && e.status === "Active" && e.invoiceId == null && e.billId == null && !lockedMonths.includes(e.entryDate.slice(0, 7)) && <EntryActions entry={e} onCorrect={() => setCorrecting(e)} onVoid={() => setVoiding(e)} />}
                  {canEdit && e.status === "Pending" && <ReviewActions entry={e} busy={approving === e.id} onApprove={() => void approve(e)} onReject={() => setRejecting(e)} />}
                </div>
              </article>
            </li>
          ))}
        </ul>
      ))}
      {result?.truncated && <p className="text-sm text-ink-600">Showing the newest 500. Narrow the period or filters to see the rest. The total above covers every match.</p>}

      {adding && lists && (
        <EntryDialog
          kind={kind}
          accounts={activeAccounts}
          categories={activeCategories}
          variant={variant}
          onClose={() => setAdding(false)}
          onSavedAndContinue={() => load()}
          onSaved={(entry) => {
            setAdding(false);
            setMessage(`${entry.entryNo}: AED ${formatMoney(entry.amount)} ${income ? "received from" : "paid to"} ${entry.party} was recorded.`);
            load();
          }}
        />
      )}
      {correcting && lists && (
        <EntryDialog
          kind={kind}
          entry={correcting}
          accounts={activeAccounts}
          categories={lists.categories.filter((c) => c.isActive || c.id === correcting.categoryId)}
          variant={variant}
          onClose={() => setCorrecting(null)}
          onSaved={(entry) => {
            setCorrecting(null);
            setMessage(`${correcting.entryNo} was voided and replaced by ${entry.entryNo}.`);
            load();
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          title={`Void ${voiding.entryNo}?`}
          message={`AED ${formatMoney(voiding.amount)} ${income ? "from" : "to"} ${voiding.party} will no longer count in balances or totals. The record stays, with who voided it and why.`}
          confirmLabel="Void"
          variant={variant}
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            await voidFinEntry(kind, voiding.id, reason);
            setMessage(`${voiding.entryNo} was voided.`);
            setVoiding(null);
            load();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          kind={kind}
          variant={variant}
          onClose={() => setImporting(false)}
          onImported={(count) => {
            setImporting(false);
            setMessage(`${count} ${income ? "income" : "expense"}${count === 1 ? "" : "s"} imported. They have no receipt yet.`);
            load();
          }}
        />
      )}
      {rejecting && (
        <VoidDialog
          title={`Reject ${rejecting.entryNo}?`}
          message={`AED ${formatMoney(rejecting.amount)} to ${rejecting.party}, entered by ${rejecting.createdBy}, will not be counted. They will see your reason.`}
          confirmLabel="Reject"
          variant={variant}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await rejectFinExpense(rejecting.id, reason);
            setMessage(`${rejecting.entryNo} was rejected.`);
            setRejecting(null);
            load();
          }}
        />
      )}
      {viewing && <ReceiptDialog title={`${income ? "Attachment" : "Receipt"} · ${viewing.party}`} files={viewing.attachments} variant={variant} onClose={() => setViewing(null)} />}
    </section>
  );
}
