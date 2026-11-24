import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip, Plus, ReceiptText, Search, SlidersHorizontal, X } from "lucide-react";
import { listFinAccounts, listFinCategories, listFinExpenses, type FinAccount, type FinCategory, type FinEntry, type FinEntryFilter, type FinEntryList } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, Select, Table, TableScroll, THead, Th, TRow, Td, cx } from "../../ui";
import { TextField } from "../../components/TextField";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { ExpenseDialog } from "./ExpenseDialog";
import { ReceiptDialog } from "./ReceiptDialog";
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
  if (count === 0) return <span className="text-sm text-ink-500">No receipt</span>;
  return (
    <button type="button" onClick={onOpen} aria-label={`View ${count === 1 ? "receipt" : `${count} receipts`} for ${entry.entryNo}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 md:min-h-9">
      <Paperclip aria-hidden="true" size={16} />
      {count === 1 ? "Receipt" : `${count} receipts`}
    </button>
  );
}

function CategoryChip({ name }: { name: string }) {
  return <span className="inline-block max-w-full truncate rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">{name}</span>;
}

function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("tabular-nums", className)}>
      <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
      {formatMoney(value)}
    </span>
  );
}

/** Every recorded expense, newest first, with search and filters and the total of whatever is shown. */
export function ExpensesPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(() => presetRange("month").from);
  const [to, setTo] = useState(() => presetRange("month").to);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
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
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFinAccounts(), listFinCategories(true)])
      .then(([accounts, categories]) => !cancelled && setLists({ accounts, categories: categories.filter((c) => c.kind === "Expense") }))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const minValue = min ? parseMoneyInput(min) : null;
  const maxValue = max ? parseMoneyInput(max) : null;
  const filter = useMemo<FinEntryFilter>(
    () => ({
      from: from || undefined, to: to || undefined, categoryId: categoryId ? Number(categoryId) : undefined, accountId: accountId ? Number(accountId) : undefined,
      min: minValue ?? undefined, max: maxValue ?? undefined, q: query.trim() || undefined,
    }),
    [from, to, categoryId, accountId, minValue, maxValue, query],
  );

  const load = useCallback(() => {
    let cancelled = false;
    listFinExpenses(filter)
      .then((list) => {
        if (cancelled) return;
        setResult(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => load(), [load]);

  function choose(next: Preset) {
    const range = presetRange(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
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
        title="Expenses"
        description="Money the company has paid out, each with its receipt."
        actions={canEdit && lists && <Button icon={Plus} onClick={() => setAdding(true)}>Add expense</Button>}
      />
      <SuccessRegion message={message} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-brand-50/60 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink-600">{filtered ? "Total of the matching expenses" : "Total spent"} · {periodLabel}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 md:text-4xl">
              {result ? <Amount value={result.total} /> : <span className="text-ink-400">...</span>}
            </p>
          </div>
          {result && <p className="text-sm text-ink-600"><span className="font-semibold tabular-nums text-ink-900">{result.count}</span> {result.count === 1 ? "expense" : "expenses"}</p>}
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
              <TextField label="Search" hideLabel placeholder="Search paid to, reference, notes or number" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Search aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            </div>
            <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          </div>
          {showFilters && filters}
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
            title={filtered || preset !== "all" ? "No expenses match" : "No expenses yet"}
            description={filtered || preset !== "all" ? "Try another period or clear the filters." : canEdit ? "Record the first expense with its receipt." : "A Manager records expenses. They will appear here."}
            action={canEdit && !filtered && preset === "all" && lists ? <Button icon={Plus} onClick={() => setAdding(true)}>Add expense</Button> : undefined}
          />
        </Card>
      )}

      {result && result.items.length > 0 && (desktop ? (
        <Card>
          <TableScroll>
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th><Th>Paid to</Th><Th>Category</Th><Th>Account</Th><Th align="right">Amount</Th><Th>Receipt</Th>
                </tr>
              </THead>
              <tbody>
                {result.items.map((e) => (
                  <TRow key={e.id}>
                    <Td className="whitespace-nowrap align-top"><span className="font-medium tabular-nums text-ink-900">{formatDay(e.entryDate)}</span><br /><span className="font-mono text-xs text-ink-500">{e.entryNo}</span></Td>
                    <Td className="max-w-md align-top">
                      <span className="font-medium text-ink-900">{e.party}</span>
                      {e.reference && <span className="ml-2 font-mono text-xs text-ink-500">{e.reference}</span>}
                      {e.notes && <span className="mt-0.5 line-clamp-2 block text-ink-600">{e.notes}</span>}
                    </Td>
                    <Td className="align-top"><CategoryChip name={e.categoryName} /></Td>
                    <Td className="align-top text-ink-700">{e.accountName}</Td>
                    <Td className="whitespace-nowrap text-right align-top text-base font-semibold text-ink-900"><Amount value={e.amount} /></Td>
                    <Td className="align-top"><ReceiptButton entry={e} onOpen={() => setViewing(e)} /></Td>
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
              <article aria-label={`${e.party} ${e.entryNo}`} className="rounded-card border border-line bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-ink-900">{e.party}</p>
                    <p className="mt-0.5 text-sm text-ink-600"><span className="tabular-nums">{formatDay(e.entryDate)}</span> · <span className="font-mono text-xs">{e.entryNo}</span></p>
                  </div>
                  <p className="shrink-0 text-lg font-semibold text-ink-900"><Amount value={e.amount} /></p>
                </div>
                {e.notes && <p className="mt-2 line-clamp-2 text-sm text-ink-700">{e.notes}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CategoryChip name={e.categoryName} />
                  <span className="text-sm text-ink-600">{e.accountName}</span>
                  {e.reference && <span className="font-mono text-xs text-ink-500">{e.reference}</span>}
                </div>
                <div className="mt-2 border-t border-line pt-2"><ReceiptButton entry={e} onOpen={() => setViewing(e)} /></div>
              </article>
            </li>
          ))}
        </ul>
      ))}
      {result?.truncated && <p className="text-sm text-ink-600">Showing the newest 500. Narrow the period or filters to see the rest. The total above covers every match.</p>}

      {adding && lists && (
        <ExpenseDialog
          accounts={activeAccounts}
          categories={activeCategories}
          variant={variant}
          onClose={() => setAdding(false)}
          onSaved={(entry) => {
            setAdding(false);
            setMessage(`${entry.entryNo}: AED ${formatMoney(entry.amount)} paid to ${entry.party} was recorded.`);
            load();
          }}
        />
      )}
      {viewing && <ReceiptDialog title={`Receipt · ${viewing.party}`} files={viewing.attachments} variant={variant} onClose={() => setViewing(null)} />}
    </section>
  );
}
