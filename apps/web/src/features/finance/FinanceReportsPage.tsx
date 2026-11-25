import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Lock, LockOpen, Sheet } from "lucide-react";
import { getFinReport, getFinReportFile, type FinReport, type FinReportAccount, type FinReportCategory, type FinReportFormat, type FinReportMonth } from "../../api/finance";
import { ApiError } from "../../api/client";
import { TextField } from "../../components/TextField";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, Table, TableScroll, THead, Th, Td, TRow, cx } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError } from "../workers/WorkersFeedback";
import { formatDay, formatMoney, formatPercent, formatShare, quietZero, todayInUae } from "./financeFormat";
import { presetRange, rangeProblem, type ReportPreset } from "./reportPeriods";

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const FILES: { format: FinReportFormat; label: string; icon: typeof FileText; extension: string }[] = [
  { format: "xlsx", label: "Excel", icon: FileSpreadsheet, extension: "xlsx" },
  { format: "pdf", label: "PDF", icon: FileText, extension: "pdf" },
  { format: "csv", label: "CSV", icon: Sheet, extension: "csv" },
];

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; report: FinReport };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

const signed = (value: number) => `${value < 0 ? "−" : ""}${formatMoney(Math.abs(value))}`;

/** Opening, plus income, less expenses, equals closing: the statement's whole story in one line. */
function BridgePanel({ report }: { report: FinReport }) {
  const { totals, period } = report;
  const steps = [
    { label: "Opening balance", value: totals.opening, sign: "" },
    { label: "Income", value: totals.income, sign: "+" },
    { label: "Expenses", value: totals.expense, sign: "−" },
    ...(totals.capital !== 0 ? [{ label: "Capital", value: Math.abs(totals.capital), sign: totals.capital < 0 ? "−" : "+" }] : []),
  ];
  return (
    <section aria-labelledby="closing" className="fade-up overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="p-5 md:p-7">
        <p id="closing" className="text-sm font-medium text-white/75">
          Closing balance · {formatDay(report.to)}
        </p>
        <p className={cx("mt-2 font-display text-4xl font-bold tracking-tight tabular-nums md:text-5xl", totals.closing < 0 && "text-red-200")}>
          {totals.closing < 0 && <span aria-label="minus">−</span>}
          <span className="mr-2 text-lg font-medium text-white/70">AED</span>
          {formatMoney(Math.abs(totals.closing))}
        </p>
        <dl className={cx("mt-6 grid grid-cols-1 gap-3", steps.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {steps.map((s) => (
            <div key={s.label} className="rounded-lg bg-white/10 px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-white/70">{s.label}</dt>
              <dd className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
                {s.sign && <span aria-hidden="true" className="text-white/60">{s.sign}</span>}
                <span className="text-xs font-medium text-white/70">AED</span>
                {formatMoney(s.value)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-white/70">
          Net result for the period: <span className="font-semibold tabular-nums text-white">AED {signed(period.net)}</span>
          {" · "}{report.entryCount} {report.entryCount === 1 ? "entry" : "entries"} · transfers between accounts are not income or expense
        </p>
      </div>
    </section>
  );
}

function AccountsTable({ report }: { report: FinReport }) {
  const { totals } = report;
  return (
    <TableScroll>
      <Table>
        <caption className="sr-only">Statement by account, in AED</caption>
        <THead>
          <tr>
            <Th>Account</Th>
            <Th align="right">Opening</Th>
            <Th align="right">Income</Th>
            <Th align="right">Expenses</Th>
            <Th align="right">Transfers in</Th>
            <Th align="right">Transfers out</Th>
            <Th align="right">Capital</Th>
            <Th align="right">Closing</Th>
          </tr>
        </THead>
        <tbody>
          {report.accounts.map((a) => (
            <TRow key={a.accountId}>
              <Td className="font-medium text-ink-900">{a.name}{!a.isActive && <span className="ml-2 text-xs font-normal text-ink-500">(switched off)</span>}</Td>
              <Td numeric>{formatMoney(a.opening)}</Td>
              <Td numeric className={quietZero(a.income)}>{formatMoney(a.income)}</Td>
              <Td numeric className={quietZero(a.expense)}>{formatMoney(a.expense)}</Td>
              <Td numeric className={quietZero(a.transfersIn)}>{formatMoney(a.transfersIn)}</Td>
              <Td numeric className={quietZero(a.transfersOut)}>{formatMoney(a.transfersOut)}</Td>
              <Td numeric className={quietZero(a.capital)}>{signed(a.capital)}</Td>
              <Td numeric className="font-display text-base font-bold text-ink-900">{signed(a.closing)}</Td>
            </TRow>
          ))}
          <tr className="bg-ink-50 font-semibold text-ink-900">
            <Td>Total</Td>
            <Td numeric>{formatMoney(totals.opening)}</Td>
            <Td numeric>{formatMoney(totals.income)}</Td>
            <Td numeric>{formatMoney(totals.expense)}</Td>
            <Td numeric>{formatMoney(totals.transfersIn)}</Td>
            <Td numeric>{formatMoney(totals.transfersOut)}</Td>
            <Td numeric>{signed(totals.capital)}</Td>
            <Td numeric>{signed(totals.closing)}</Td>
          </tr>
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** On a phone each account is a short statement of its own, so nothing scrolls sideways. */
function AccountStatements({ accounts }: { accounts: FinReportAccount[] }) {
  return (
    <ul className="divide-y divide-line">
      {accounts.map((a) => (
        <li key={a.accountId} className="px-5 py-4">
          <p className="text-[15px] font-semibold text-ink-900">{a.name}{!a.isActive && <span className="ml-2 text-xs font-normal text-ink-500">(switched off)</span>}</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-ink-500">Opening</dt><dd className="text-right text-ink-700">{formatMoney(a.opening)}</dd>
            <dt className="text-ink-500">Income</dt><dd className={cx("text-right text-ink-700", quietZero(a.income))}>+ {formatMoney(a.income)}</dd>
            <dt className="text-ink-500">Expenses</dt><dd className={cx("text-right text-ink-700", quietZero(a.expense))}>− {formatMoney(a.expense)}</dd>
            {a.capital !== 0 && (
              <>
                <dt className="text-ink-600">Capital</dt><dd className="text-right">{a.capital < 0 ? "−" : "+"} {formatMoney(Math.abs(a.capital))}</dd>
              </>
            )}
            {(a.transfersIn > 0 || a.transfersOut > 0) && (
              <>
                <dt className="text-ink-600">Transfers in / out</dt><dd className="text-right">{formatMoney(a.transfersIn)} / {formatMoney(a.transfersOut)}</dd>
              </>
            )}
            <dt className="border-t border-line pt-1.5 text-sm font-semibold text-ink-900">Closing</dt>
            <dd className="border-t border-line pt-1.5 text-right font-display text-lg font-bold text-ink-900">AED {signed(a.closing)}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CategoryCard({ title, rows, total, bar }: { title: string; rows: FinReportCategory[]; total: number; bar: string }) {
  return (
    <Card>
      <CardHeader title={title} description={`AED ${formatMoney(total)} in total`} />
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-ink-600">Nothing was recorded in this period.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-4 px-5 pb-5">
          {rows.map((c) => (
            <li key={c.categoryId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{c.name} <span className="font-normal text-ink-500">· {c.count}</span></span>
                <span className="font-semibold tabular-nums text-ink-900">AED {formatMoney(c.amount)}</span>
                <span className="w-14 text-right tabular-nums text-ink-600">{formatShare(c.share)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                <div className={cx("h-full rounded-full", bar)} style={{ width: `${Math.max(c.share, 1)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2026", and for a month the period only partly covers, which days: "10 to 31 Nov 2026". */
function monthLabel(m: FinReportMonth, from: string, to: string): { name: string; part: string | null } {
  const [year, month] = m.month.split("-").map(Number);
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = from.startsWith(m.month) ? Number(from.slice(8)) : 1;
  const last = to.startsWith(m.month) ? Number(to.slice(8)) : lastDay;
  return { name, part: first === 1 && last === lastDay ? null : `${first} to ${last} ${MONTH_NAMES[month - 1]} only` };
}

function LockMark({ month }: { month: FinReportMonth }) {
  return month.isLocked ? (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700" title={month.lockedBy ? `Locked by ${month.lockedBy}` : undefined}>
      <Lock aria-hidden="true" size={14} /> Locked
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-600">
      <LockOpen aria-hidden="true" size={14} /> Open
    </span>
  );
}

/** One row per month with its own totals, so each month can be set against another set of books. A locked month has been checked and closed. */
function MonthsCard({ report, desktop }: { report: FinReport; desktop: boolean }) {
  const months = report.months ?? [];
  const entries = months.reduce((sum, m) => sum + m.entries, 0);
  return (
    <Card>
      <CardHeader title="Month by month" description="To compare with another system, set the period to whole months. A locked month has been checked and closed." />
      {months.length === 0 ? null : desktop ? (
        <TableScroll>
          <Table>
            <caption className="sr-only">Income, expenses and net for each month, in AED</caption>
            <THead>
              <tr>
                <Th>Month</Th>
                <Th align="right">Entries</Th>
                <Th align="right">Income</Th>
                <Th align="right">Expenses</Th>
                <Th align="right">Net</Th>
                <Th align="right">Capital</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {months.map((m) => {
                const label = monthLabel(m, report.from, report.to);
                return (
                  <TRow key={m.month}>
                    <Td className="font-medium text-ink-900">
                      {label.name}
                      {label.part && <span className="block text-xs font-normal text-ink-500">{label.part}</span>}
                    </Td>
                    <Td numeric>{m.entries}</Td>
                    <Td numeric className={quietZero(m.income)}>{formatMoney(m.income)}</Td>
                    <Td numeric className={quietZero(m.expense)}>{formatMoney(m.expense)}</Td>
                    <Td numeric className={cx("font-semibold", m.net < 0 ? "text-danger" : "text-ink-900")}>{signed(m.net)}</Td>
                    <Td numeric className={quietZero(m.capital)}>{signed(m.capital)}</Td>
                    <Td><LockMark month={m} /></Td>
                  </TRow>
                );
              })}
              <tr className="bg-ink-50 font-semibold text-ink-900">
                <Td>Total</Td>
                <Td numeric>{entries}</Td>
                <Td numeric>{formatMoney(report.period.income)}</Td>
                <Td numeric>{formatMoney(report.period.expense)}</Td>
                <Td numeric>{signed(report.period.net)}</Td>
                <Td numeric>{signed(report.totals.capital)}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {months.map((m) => {
            const label = monthLabel(m, report.from, report.to);
            if (m.entries === 0 && m.capital === 0) {
              return (
                <li key={m.month} className="flex items-center justify-between gap-3 px-5 py-3">
                  <p className="text-sm text-ink-900">
                    <span className="font-medium">{label.name}</span> <span className="text-ink-500">· nothing recorded{label.part ? `, ${label.part}` : ""}</span>
                  </p>
                  <LockMark month={m} />
                </li>
              );
            }

            return (
              <li key={m.month} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{label.name}</p>
                    {label.part && <p className="text-xs text-ink-500">{label.part}</p>}
                  </div>
                  <LockMark month={m} />
                </div>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                  <dt className="text-ink-500">Income</dt><dd className={cx("text-right text-ink-700", quietZero(m.income))}>{formatMoney(m.income)}</dd>
                  <dt className="text-ink-500">Expenses</dt><dd className={cx("text-right text-ink-700", quietZero(m.expense))}>{formatMoney(m.expense)}</dd>
                  <dt className="border-t border-line pt-1 font-semibold text-ink-900">Net</dt>
                  <dd className={cx("border-t border-line pt-1 text-right font-display text-base font-bold", m.net < 0 ? "text-danger" : "text-ink-900")}>AED {signed(m.net)}</dd>
                  <dt className="text-ink-500">{m.entries} {m.entries === 1 ? "entry" : "entries"}</dt>
                  <dd className="text-right text-ink-500">{m.capital !== 0 ? `Capital ${signed(m.capital)}` : ""}</dd>
                </dl>
              </li>
            );
          })}
          <li className="bg-ink-50 px-5 py-4 font-semibold text-ink-900">
            <div className="flex items-baseline justify-between gap-3 tabular-nums">
              <span>Total net</span>
              <span>AED {signed(report.period.net)}</span>
            </div>
            <p className="mt-0.5 text-sm font-normal text-ink-600 tabular-nums">Income {formatMoney(report.period.income)} · expenses {formatMoney(report.period.expense)} · {entries} {entries === 1 ? "entry" : "entries"}</p>
          </li>
        </ul>
      )}
    </Card>
  );
}

/** What each partner had at the start of the period, put in, took back and holds at the end, with the exact share. */
function PartnersCard({ report }: { report: FinReport }) {
  const rows = report.partners ?? [];
  return (
    <Card>
      <CardHeader title="Partners' capital" description="Each partner's capital over the period, and their share of all capital at the end of it" />
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-ink-600">No partner capital is recorded for this period.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((p) => (
            <li key={p.partnerId} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{p.name}</span>
                <span className="font-semibold tabular-nums text-ink-900">AED {formatMoney(p.closing)}</span>
                <span className="w-20 text-right font-semibold tabular-nums text-brand-700">{formatPercent(p.share)}</span>
              </div>
              <p className="mt-1 text-sm tabular-nums text-ink-600">
                Opening {formatMoney(p.opening)} · added {formatMoney(p.added)} · returned {formatMoney(p.returned)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A period statement per account and by category, with the same figures downloadable as Excel, PDF and CSV. */
export function FinanceReportsPage() {
  const today = useMemo(() => todayInUae(), []);
  const desktop = useIsDesktop();
  const [preset, setPreset] = useState<ReportPreset>("month");
  const [range, setRange] = useState(() => presetRange("month", today));
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [busy, setBusy] = useState<FinReportFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

  const rangeError = rangeProblem(range, today);

  const refresh = useCallback(async (from: string, to: string) => {
    const request = ++latest.current;
    setLoad({ status: "loading" });
    try {
      const report = await getFinReport(from, to);
      if (request === latest.current) setLoad({ status: "ready", report });
    } catch (error) {
      if (request === latest.current) setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    if (!rangeProblem({ from: range.from, to: range.to }, today)) void refresh(range.from, range.to);
    else latest.current++;
  }, [range.from, range.to, today, refresh]);

  function choose(next: ReportPreset) {
    setPreset(next);
    if (next !== "custom") setRange(presetRange(next, today));
  }

  async function download(format: FinReportFormat, extension: string) {
    setBusy(format);
    setProblem(null);
    try {
      saveBlob(await getFinReportFile(format, range.from, range.to), `Finance_Report_${range.from}_${range.to}.${extension}`);
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(null);
    }
  }

  const ready = load.status === "ready" ? load.report : null;

  return (
    <section className="space-y-5">
      <PageHeader title="Reports" description="Where each account started and ended, and what moved it, for any period. Voided entries are never counted." />

      <Card>
        <div className="grid gap-4 p-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-end">
          <div role="radiogroup" aria-label="Period" className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={preset === p.key}
                onClick={() => choose(p.key)}
                className={cx(
                  "min-h-11 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:min-h-9 sm:px-4",
                  preset === p.key ? "bg-sidebar text-white" : "text-ink-700 hover:bg-ink-50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:max-w-md">
            <TextField label="From date" type="date" value={range.from} max={today} onChange={(e) => { setPreset("custom"); setRange({ ...range, from: e.target.value }); }} />
            <TextField label="To date" type="date" value={range.to} max={today} onChange={(e) => { setPreset("custom"); setRange({ ...range, to: e.target.value }); }} />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Download this report">
            {FILES.map((f) => (
              <Button key={f.format} variant="secondary" icon={f.icon} disabled={!!rangeError || busy !== null} onClick={() => void download(f.format, f.extension)}>
                {busy === f.format ? "Preparing..." : f.label}
              </Button>
            ))}
          </div>
        </div>
        {rangeError && <p role="alert" className="border-t border-line px-5 py-3 text-sm text-danger">{rangeError}</p>}
      </Card>
      {problem && <ActionFailure message={problem} />}

      {load.status === "loading" && <LoadingState label="Preparing the report..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => void refresh(range.from, range.to)} />}

      {ready && (
        <>
          <BridgePanel report={ready} />
          <Card>
            <CardHeader title="By account" description={`${formatDay(ready.from)} to ${formatDay(ready.to)}, in AED`} />
            {ready.accounts.length === 0 ? (
              <EmptyState icon={Download} title="No accounts in this period" description="Accounts appear here from the date they open." />
            ) : desktop ? (
              <AccountsTable report={ready} />
            ) : (
              <AccountStatements accounts={ready.accounts} />
            )}
          </Card>
          <MonthsCard report={ready} desktop={desktop} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <CategoryCard title="Income by category" rows={ready.incomeCategories} total={ready.period.income} bar="bg-brand-500" />
            <CategoryCard title="Expenses by category" rows={ready.expenseCategories} total={ready.period.expense} bar="bg-amber-400" />
          </div>
          <PartnersCard report={ready} />
        </>
      )}
    </section>
  );
}
